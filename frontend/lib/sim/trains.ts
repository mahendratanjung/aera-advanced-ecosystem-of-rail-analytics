/**
 * Schedule-driven train positions (NET-03, SIM-02, SIM-04).
 *
 * A port of backend/aera_twin/timetable.py. Positions are a pure function of the line file,
 * the simulation clock and the active disruptions, so every browser and the twin service
 * draw the same picture. Keep the two files in step; trains.test.ts checks them against
 * fixtures exported from Python.
 *
 * Times are epoch seconds unless the name says Ms.
 */

import type { Disruption, LineData } from "../types";

const KL_OFFSET_S = 8 * 3600;
const DAY_S = 86400;

export interface Trip {
  id: string;
  directionId: number;
  start: number;
}

export interface TrainState {
  tripId: string;
  directionId: number;
  status: "dwelling" | "moving" | "held";
  stopIndex: number;
  nextIndex: number | null;
  distanceM: number;
  loadPct: number;
}

export interface Departure {
  tripId: string;
  directionId: number;
  headsign: string;
  arrival: number;
  departure: number;
  delayS: number;
  atPlatform: boolean;
  loadPct: number;
}

export function serviceDayStart(t: number): number {
  return Math.floor((t + KL_OFFSET_S) / DAY_S) * DAY_S - KL_OFFSET_S;
}

export function localHour(t: number): number {
  return ((((t + KL_OFFSET_S) % DAY_S) + DAY_S) % DAY_S) / 3600;
}

export function demand(hour: number): number {
  if (hour < 5.75 || hour > 23.75) return 0;
  const g = (mu: number, sigma: number) => Math.exp(-0.5 * ((hour - mu) / sigma) ** 2);
  return Math.min(1, 0.12 + 0.88 * g(8.0, 0.9) + 0.8 * g(18.25, 1.0) + 0.25 * g(13.0, 1.6));
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

export function trainLoadPct(trip: Trip, stopIndex: number, nStops: number, t: number): number {
  const p = stopIndex / Math.max(1, nStops - 1);
  const profile = Math.sin(Math.PI * p) ** 0.8;
  const jitter = ((Math.floor(trip.start / 60) * 7919) % 1000) / 1000;
  const base = 0.1 + 0.85 * demand(localHour(t));
  return round1(Math.max(3, Math.min(115, base * (0.35 + 0.65 * profile) * (0.9 + 0.2 * jitter) * 100)));
}

export class LineModel {
  readonly distance: Record<string, number> = {};
  readonly stopIndex: Record<number, Record<string, number>> = {};
  readonly duration: Record<number, number> = {};
  private readonly maxDuration: number;

  readonly data: LineData;

  constructor(data: LineData) {
    this.data = data;
    for (const s of data.stations) this.distance[s.id] = s.distance_m;
    for (const d of data.directions) {
      this.stopIndex[d.direction_id] = Object.fromEntries(d.stops.map((s, i) => [s.station_id, i]));
      this.duration[d.direction_id] = d.stops[d.stops.length - 1].dep;
    }
    this.maxDuration = Math.max(...Object.values(this.duration));
  }

  direction(id: number) {
    return this.data.directions.find((d) => d.direction_id === id)!;
  }

  servicesOn(dayStart: number): string[] {
    const weekday = (new Date((dayStart + 1 + KL_OFFSET_S) * 1000).getUTCDay() + 6) % 7; // Monday = 0
    return Object.entries(this.data.calendar)
      .filter(([, days]) => days[weekday])
      .map(([sid]) => sid);
  }

  /** Trips whose first departure lies in [tFrom, tTo], with any inserted extra trains. */
  tripsBetween(directionId: number, tFrom: number, tTo: number, disruptions: Disruption[] = []): Trip[] {
    const out: Trip[] = [];
    for (const d of disruptions) {
      const t0 = Math.floor(d.start_ms / 1000);
      if (d.kind === "insert" && d.direction_id === directionId && tFrom <= t0 && t0 <= tTo) {
        out.push({ id: `${this.data.id}-${directionId}-x${t0}`, directionId, start: t0 });
      }
    }
    let day = serviceDayStart(tFrom) - DAY_S;
    const lastDay = serviceDayStart(tTo);
    while (day <= lastDay) {
      for (const sid of this.servicesOn(day)) {
        for (const w of this.data.frequencies[sid]?.[String(directionId)] ?? []) {
          const first = day + w.start;
          const end = day + w.end;
          const k0 = Math.max(0, Math.ceil((tFrom - first) / w.headway));
          for (let t0 = first + k0 * w.headway; t0 < end && t0 <= tTo; t0 += w.headway) {
            out.push({ id: `${this.data.id}-${directionId}-${t0}`, directionId, start: t0 });
          }
        }
      }
      day += DAY_S;
    }
    out.sort((a, b) => a.start - b.start);
    return out;
  }

  private suspendEntry(d: Disruption, directionId: number): string | null {
    const idx = this.stopIndex[directionId];
    const a = d.stop_id;
    const b = d.to_stop_id ?? d.stop_id;
    if (!(a in idx) || !(b in idx)) return null;
    return idx[a] <= idx[b] ? a : b;
  }

  timeline(trip: Trip, disruptions: Disruption[]): [number, number][] {
    const stops = this.direction(trip.directionId).stops;
    const relevant = disruptions.filter((d) => d.direction_id === null || d.direction_id === trip.directionId);
    const out: [number, number][] = [];
    let shift = 0;
    for (const s of stops) {
      const arr = trip.start + s.arr + shift;
      let dep = trip.start + s.dep + shift;
      for (const d of relevant) {
        const start = d.start_ms / 1000;
        const end = d.end_ms === null ? Infinity : d.end_ms / 1000;
        if (d.kind === "delay" && d.stop_id === s.station_id) {
          if (start <= dep && dep < end) dep += d.delay_s;
        } else if (d.kind === "hold" && d.stop_id === s.station_id) {
          if (start <= dep && end > arr) dep = Math.max(dep, end);
        } else if (d.kind === "suspend" && this.suspendEntry(d, trip.directionId) === s.station_id) {
          if (start <= dep && dep < end) dep = Math.max(dep, end);
        }
      }
      shift = dep - (trip.start + s.dep); // lateness so far; stays Infinity after an open-ended hold
      out.push([arr, dep]);
    }
    return out;
  }

  private lookback(t: number, disruptions: Disruption[]): number {
    let extra = 0;
    for (const d of disruptions) {
      const start = d.start_ms / 1000;
      if (start > t) continue;
      extra += d.delay_s;
      if (d.kind === "hold" || d.kind === "suspend") {
        const end = d.end_ms === null ? t : Math.min(t, d.end_ms / 1000);
        extra += Math.max(0, end - start);
      }
    }
    return this.maxDuration + extra + 60;
  }

  stateAt(trip: Trip, times: [number, number][], t: number): TrainState | null {
    if (t < times[0][0] || t > times[times.length - 1][1]) return null;
    const stops = this.direction(trip.directionId).stops;
    const n = stops.length;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (times[mid][0] <= t) lo = mid;
      else hi = mid - 1;
    }
    const i = lo;
    const [arr, dep] = times[i];
    const sid = stops[i].station_id;
    const loadPct = trainLoadPct(trip, i, n, t);
    if (t <= dep || i === n - 1) {
      const status = t > arr + (stops[i].dep - stops[i].arr) + 1 ? "held" : "dwelling";
      return { tripId: trip.id, directionId: trip.directionId, status, stopIndex: i, nextIndex: i < n - 1 ? i + 1 : null,
        distanceM: this.distance[sid], loadPct };
    }
    const nxt = stops[i + 1].station_id;
    const span = times[i + 1][0] - dep;
    let f = span <= 0 ? 1 : (t - dep) / span;
    f = f * f * (3 - 2 * f);
    const distanceM = this.distance[sid] + (this.distance[nxt] - this.distance[sid]) * f;
    return { tripId: trip.id, directionId: trip.directionId, status: "moving", stopIndex: i, nextIndex: i + 1, distanceM, loadPct };
  }

  activeTrains(t: number, disruptions: Disruption[]): TrainState[] {
    const out: TrainState[] = [];
    const lb = this.lookback(t, disruptions);
    for (const d of this.data.directions) {
      for (const trip of this.tripsBetween(d.direction_id, t - lb, t, disruptions)) {
        const st = this.stateAt(trip, this.timeline(trip, disruptions), t);
        if (st) out.push(st);
      }
    }
    return out;
  }

  nextDepartures(stationId: string, t: number, disruptions: Disruption[], limit = 3, horizonS = 7200): Record<number, Departure[]> {
    const result: Record<number, Departure[]> = {};
    const lb = this.lookback(t, disruptions);
    for (const dd of this.data.directions) {
      const d = dd.direction_id;
      const idx = this.stopIndex[d][stationId];
      const rows: Departure[] = [];
      if (idx === undefined || idx === dd.stops.length - 1) {
        result[d] = rows;
        continue;
      }
      for (const trip of this.tripsBetween(d, t - lb, t + horizonS, disruptions)) {
        const [arr, dep] = this.timeline(trip, disruptions)[idx];
        if (dep < t || arr === Infinity) continue;
        const nominal = trip.start + dd.stops[idx].arr;
        rows.push({ tripId: trip.id, directionId: d, headsign: dd.headsign, arrival: arr, departure: dep,
          delayS: Math.round(arr - nominal), atPlatform: arr <= t && t <= dep,
          loadPct: trainLoadPct(trip, idx, dd.stops.length, arr) });
      }
      rows.sort((a, b) => a.arrival - b.arrival);
      result[d] = rows.slice(0, limit);
    }
    return result;
  }
}
