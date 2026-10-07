/**
 * Predicted crowding inside every train.
 *
 * The typical week (built by backend/aera_twin/ridership from data.gov.my gate data) gives
 * passengers per hour on each segment. A train's share of that flow depends on how long
 * passengers have waited for it, so:
 *
 *   load = flow(segment, weekday, time) x scheduled headway / capacity
 *          x gap factor (actual wait since the train ahead / scheduled wait)
 *          + event surges boarding upstream
 *
 * Disruptions change the gaps (through the shared timetable in lib/sim/trains.ts), so a held
 * train leaves the next one packed, exactly as riders see it. Everything is a pure function
 * of the model, the simulation clock and the disruption list, so every screen agrees.
 */

import type { Disruption } from "../types";
import { type LineModel, type Trip, serviceDayStart } from "../sim/trains.ts";

const KL_OFFSET_S = 8 * 3600;
export const CARS = 4;
/** Middle cars fill first because platform stairs land there. Modelled, not measured. */
const CAR_WEIGHTS = [0.88, 1.08, 1.09, 0.95];
const GAP_LOOKBACK = 6;
const MAX_LOOKAHEAD_S = 3 * 3600;

export interface CrowdModelData {
  line_id: string;
  capacity: number;
  generated_at: string;
  window: { from: string; to: string; weeks: number };
  source: { od: string; profile: string };
  stations: string[];
  load: Record<string, Record<string, number[][]>>;
  board: Record<string, Record<string, number[][]>>;
  band: Record<string, [number, number]>;
  accuracy: { days: number; mape_pct: number | null; mean_ape_pct: number | null };
  trend: { start: string; daily: number[] };
}

export interface TrainRun {
  trip: Trip;
  times: [number, number][];
  /** Load in percent of capacity on the leg leaving each stop, in travel order. */
  legs: number[];
}

export interface Departure {
  run: TrainRun;
  stopIndex: number;
  arrival: number;
  departure: number;
  delayS: number;
  loadPct: number;
  low: number;
  high: number;
}

export interface TripOption {
  run: TrainRun;
  depart: number;
  arrive: number;
  minutes: number;
  legLoads: number[];
  peak: number;
  mean: number;
}

export function weekdayOf(t: number): number {
  const d = new Date((t + KL_OFFSET_S) * 1000);
  return (d.getUTCDay() + 6) % 7; // Monday = 0
}

export function hourOf(t: number): number {
  return ((((t + KL_OFFSET_S) % 86400) + 86400) % 86400) / 3600;
}

/** Hourly value read at a fractional hour, linear between hour centres. */
function interp(row: number[], hour: number): number {
  const x = hour - 0.5;
  const h0 = Math.floor(x);
  const f = x - h0;
  const a = row[((h0 % 24) + 24) % 24];
  const b = row[(((h0 + 1) % 24) + 24) % 24];
  return a + (b - a) * f;
}

function jitter(trip: Trip): number {
  const x = Math.sin(trip.start * 12.9898) * 43758.5453;
  return 0.94 + 0.12 * (x - Math.floor(x));
}

export class CrowdEngine {
  readonly idx: Record<string, number>;
  readonly line: LineModel;
  readonly data: CrowdModelData;

  constructor(line: LineModel, data: CrowdModelData) {
    this.line = line;
    this.data = data;
    this.idx = Object.fromEntries(data.stations.map((s, i) => [s, i]));
  }

  get capacity() {
    return this.data.capacity;
  }

  /** Station id at a stop index in travel order. */
  stopId(dir: number, k: number): string {
    return this.line.direction(dir).stops[k].station_id;
  }

  /** Segment index (station order) of the leg leaving stop k. */
  segment(dir: number, k: number): number {
    return Math.min(this.idx[this.stopId(dir, k)], this.idx[this.stopId(dir, k + 1)]);
  }

  /**
   * Scheduled seconds between departures from the origin at time t, or null outside service.
   * With extend, a time shortly after the last departure still counts, because the last
   * trains are still out on the line.
   */
  headway(dir: number, t: number, extend = true): number | null {
    let late: number | null = null;
    for (const day of [serviceDayStart(t), serviceDayStart(t) - 86400]) {
      for (const sid of this.line.servicesOn(day)) {
        for (const w of this.line.data.frequencies[sid]?.[String(dir)] ?? []) {
          if (t >= day + w.start && t < day + w.end) return w.headway;
          if (extend && t >= day + w.end && t < day + w.end + this.line.duration[dir]) late = w.headway;
        }
      }
    }
    return late;
  }

  flow(table: "load" | "board", dir: number, i: number, t: number): number {
    return interp(this.data[table][String(weekdayOf(t))][String(dir)][i], hourOf(t));
  }

  /** Typical load of a train leaving stop k at time t, before disruptions. */
  typicalLegLoad(dir: number, k: number, t: number, headwayS?: number): number {
    const h = headwayS ?? this.headway(dir, t) ?? 420;
    return ((this.flow("load", dir, this.segment(dir, k), t) * h) / 3600 / this.capacity) * 100;
  }

  band(t: number): [number, number] {
    return this.data.band[String(weekdayOf(t))] ?? [0.95, 1.05];
  }

  /** Trains of one direction in a time window, with predicted load on every leg. */
  runs(dir: number, from: number, to: number, disruptions: Disruption[], mult = 1): TrainRun[] {
    const trips = this.line.tripsBetween(dir, from, to);
    const timed = trips.map((trip) => ({ trip, times: this.line.timeline(trip, disruptions) }));
    const surges = disruptions.filter((d) => d.kind === "surge");
    const nStops = this.line.direction(dir).stops.length;
    return timed.map((r, n) => {
      const prev = n > 0 ? timed[n - 1] : null;
      const legs: number[] = [];
      for (let k = 0; k < nStops - 1; k++) {
        const dep = r.times[k][1];
        if (!Number.isFinite(dep)) {
          legs.push(legs.length ? legs[legs.length - 1] : 0);
          continue;
        }
        const sched = this.headway(dir, r.trip.start, false) ?? 420;
        let ratio = 0;
        let count = 0;
        for (let j = Math.max(0, k - GAP_LOOKBACK); j <= k; j++) {
          const gap = prev ? r.times[j][1] - prev.times[j][1] : sched;
          ratio += Math.max(0.5, Math.min(3, Number.isFinite(gap) ? gap / sched : 3));
          count++;
        }
        let load = this.typicalLegLoad(dir, k, dep, sched) * (ratio / count);
        for (const s of surges) {
          const x = this.line.stopIndex[dir][s.stop_id];
          if (x === undefined || x > k || k - x > 10) continue;
          const depX = r.times[x][1];
          if (depX < s.start_ms / 1000 || (s.end_ms !== null && depX >= s.end_ms / 1000)) continue;
          const extra = (s.multiplier - 1) * this.flow("board", dir, this.idx[s.stop_id], depX) * sched / 3600;
          load += (extra * Math.pow(0.82, k - x) / this.capacity) * 100;
        }
        legs.push(load * mult * jitter(r.trip));
      }
      return { ...r, legs };
    });
  }

  /** Every train on the line now, with the load it is carrying. */
  live(t: number, disruptions: Disruption[], mult = 1) {
    const out: { run: TrainRun; state: NonNullable<ReturnType<LineModel["stateAt"]>>; loadPct: number }[] = [];
    for (const d of this.line.data.directions) {
      const dir = d.direction_id;
      for (const run of this.runs(dir, t - this.lookback(t, disruptions), t, disruptions, mult)) {
        const state = this.line.stateAt(run.trip, run.times, t);
        if (!state) continue;
        const k = Math.min(state.stopIndex, run.legs.length - 1);
        out.push({ run, state, loadPct: run.legs[k] ?? 0 });
      }
    }
    return out;
  }

  lookback(t: number, disruptions: Disruption[]): number {
    let extra = 0;
    for (const d of disruptions) {
      if (d.start_ms / 1000 > t) continue;
      extra += d.delay_s;
      if (d.kind === "hold" || d.kind === "suspend") extra += Math.max(0, (d.end_ms === null ? t : Math.min(t, d.end_ms / 1000)) - d.start_ms / 1000);
    }
    return Math.max(...Object.values(this.line.duration)) + extra + 600;
  }

  /** Next trains leaving a station in one direction, with the load they will carry. */
  departures(stationId: string, dir: number, t: number, disruptions: Disruption[], mult = 1, limit = 4): Departure[] {
    const k = this.line.stopIndex[dir][stationId];
    const stops = this.line.direction(dir).stops;
    if (k === undefined || k === stops.length - 1) return [];
    const [lo, hi] = this.band(t);
    return this.runs(dir, t - this.lookback(t, disruptions), t + MAX_LOOKAHEAD_S, disruptions, mult)
      .filter((r) => r.times[k][1] >= t && Number.isFinite(r.times[k][0]))
      .sort((a, b) => a.times[k][0] - b.times[k][0])
      .slice(0, limit)
      .map((run) => ({
        run,
        stopIndex: k,
        arrival: run.times[k][0],
        departure: run.times[k][1],
        delayS: Math.round(run.times[k][0] - (run.trip.start + stops[k].arr)),
        loadPct: run.legs[k],
        low: run.legs[k] * lo,
        high: run.legs[k] * hi,
      }));
  }

  /** Rides from o to d leaving within the window, with the crowding on every leg. */
  trip(o: string, d: string, t: number, disruptions: Disruption[], mult = 1, windowS = 3600): { dir: number; options: TripOption[] } | null {
    if (o === d || !(o in this.idx) || !(d in this.idx)) return null;
    const dir = this.idx[d] > this.idx[o] ? 1 : 0;
    const ko = this.line.stopIndex[dir][o];
    const kd = this.line.stopIndex[dir][d];
    const options = this.runs(dir, t - this.lookback(t, disruptions), t + windowS, disruptions, mult)
      .filter((r) => r.times[ko][1] >= t && r.times[ko][1] <= t + windowS && Number.isFinite(r.times[kd][0]))
      .map((run) => {
        const legLoads = run.legs.slice(ko, kd);
        return {
          run, depart: run.times[ko][1], arrive: run.times[kd][0],
          minutes: Math.round((run.times[kd][0] - run.times[ko][1]) / 60), legLoads,
          peak: Math.max(...legLoads), mean: legLoads.reduce((a, b) => a + b, 0) / legLoads.length,
        };
      })
      .sort((a, b) => a.depart - b.depart);
    return { dir, options };
  }

  /** People likely waiting for the next train: boardings since the last departure. */
  waiting(stationId: string, dir: number, t: number, lastDeparture: number | null, mult = 1): number {
    const i = this.idx[stationId];
    const since = lastDeparture === null ? (this.headway(dir, t) ?? 0) / 2 : Math.max(0, t - lastDeparture);
    return Math.round((this.flow("board", dir, i, t) * Math.min(since, 1800)) / 3600 * mult);
  }

  /** Typical per-train load by hour for one leg on a given weekday (for charts). */
  typicalDay(dir: number, seg: number, weekday: number): (number | null)[] {
    const out: (number | null)[] = [];
    // Pick a real date with the right weekday so the right service (and headway) applies.
    const base = Date.UTC(2026, 9, 5) / 1000 - KL_OFFSET_S + weekday * 86400; // Mon 5 Oct 2026, KL midnight
    for (let h = 0; h < 24; h++) {
      const t = base + h * 3600 + 1800;
      const hw = this.headway(dir, t);
      const flow = this.data.load[String(weekday)][String(dir)][seg][h];
      out.push(hw === null || flow === 0 ? null : (flow * hw) / 3600 / this.capacity * 100);
    }
    return out;
  }

  carLoads(loadPct: number, dir: number): number[] {
    const w = dir === 1 ? CAR_WEIGHTS : [...CAR_WEIGHTS].reverse();
    return w.map((x) => loadPct * x);
  }

  stationBoardingsTypical(weekday: number): { id: string; total: number }[] {
    const b = this.data.board[String(weekday)];
    return this.data.stations.map((id, i) => ({
      id,
      total: [0, 1].reduce((s, d) => s + b[String(d)][i].reduce((a, v) => a + v, 0), 0),
    }));
  }
}
