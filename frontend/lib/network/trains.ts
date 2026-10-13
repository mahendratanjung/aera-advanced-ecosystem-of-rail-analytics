/**
 * Trains on every line other than the Kelana Jaya Line (TRAINS-01 to TRAINS-03), from
 * data/network/trains.json (built by backend/aera_twin/gtfs/trains.py).
 *
 * Positions are a pure function of the timetable and the shared sim clock, like the Kelana
 * Jaya trains: headway windows for Rapid Rail and ERL, timetabled trips for KTM Komuter. These
 * lines have no crowding model, so a train here only knows where it is and where it is going.
 * Disruptions apply to the Kelana Jaya Line only.
 *
 * Times are epoch seconds.
 */

import { serviceDayStart } from "../sim/trains.ts";

const KL_OFFSET_S = 8 * 3600;
const DAY_S = 86400;

export type TrainSource = "rapid" | "ktmb" | "estimate" | "suspended";

export interface SimStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Metres along the drawn track. */
  d: number;
}

export interface SimPattern {
  headsign: string;
  /** Indexes into the line's stops, in travel order. */
  stops: number[];
  /** [arrival, departure] seconds after the trip starts. */
  times: [number, number][];
}

export interface SimLine {
  id: string;
  name: string;
  mode: string;
  color: string | null;
  source: TrainSource;
  note?: string;
  level: "elevated" | "ground";
  /** Stretches in tunnel, metres along the track. */
  tunnels: [number, number][];
  stops: SimStop[];
  shape: [number, number][];
  shape_d: number[];
  patterns: SimPattern[];
  /** service -> [pattern, start, end, headway] (seconds after service-day midnight). */
  frequencies: Record<string, [number, number, number, number][]>;
  /** service -> [pattern, start]. */
  trips: Record<string, [number, number][]>;
  calendar: Record<string, number[]>;
  /** YYYYMMDD -> services added or removed that day (public holidays). */
  dates: Record<string, { add: string[]; remove: string[] }>;
}

export interface SimNetwork {
  source: Record<string, string>;
  lines: SimLine[];
}

export interface NetTrain {
  /** "net:" + line + pattern + start, so it never clashes with a Kelana Jaya trip id. */
  id: string;
  line: SimLine;
  headsign: string;
  /** Metres along the drawn track, middle of the train. */
  d: number;
  /** +1 when travelling towards higher distances. */
  sign: 1 | -1;
  /** Stop the train is at or has just left (index into line.stops). */
  at: number;
  /** Stop it is heading for, or null at the end of the trip. */
  next: number | null;
  /** 0..1 of the way from `at` to `next` (eased like the Kelana Jaya trains). */
  f: number;
  status: "dwelling" | "moving";
  /** Epoch seconds the train reaches `next`. */
  nextArrival: number | null;
  /** Epoch seconds the trip ends. */
  ends: number;
}

const ymd = (dayStart: number) => new Date((dayStart + KL_OFFSET_S) * 1000).toISOString().slice(0, 10).replace(/-/g, "");

/** Services running on the service day starting at `dayStart`, with holiday swaps applied. */
export function servicesOn(line: SimLine, dayStart: number): string[] {
  const weekday = (new Date((dayStart + 1 + KL_OFFSET_S) * 1000).getUTCDay() + 6) % 7; // Monday = 0
  const on = new Set(Object.entries(line.calendar).filter(([, days]) => days[weekday]).map(([s]) => s));
  const swap = line.dates[ymd(dayStart)];
  if (swap) {
    for (const s of swap.remove) on.delete(s);
    for (const s of swap.add) on.add(s);
  }
  return [...on];
}

function place(line: SimLine, p: SimPattern, pi: number, start: number, t: number): NetTrain | null {
  const rel = t - start;
  const n = p.times.length;
  if (rel < p.times[0][0] || rel > p.times[n - 1][1]) return null;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (p.times[mid][0] <= rel) lo = mid;
    else hi = mid - 1;
  }
  const at = p.stops[lo];
  const next = lo < n - 1 ? p.stops[lo + 1] : null;
  const a = line.stops[at].d;
  const b = next === null ? a : line.stops[next].d;
  const sign: 1 | -1 = next === null ? (line.stops[p.stops[n - 1]].d >= line.stops[p.stops[0]].d ? 1 : -1) : b >= a ? 1 : -1;
  const base = {
    id: `net:${line.id}:${pi}:${start}`, line, headsign: p.headsign, sign, at, next,
    nextArrival: next === null ? null : start + p.times[lo + 1][0], ends: start + p.times[n - 1][1],
  };
  if (rel <= p.times[lo][1] || next === null) return { ...base, d: a, f: 0, status: "dwelling" };
  const span = p.times[lo + 1][0] - p.times[lo][1];
  let f = span <= 0 ? 1 : (rel - p.times[lo][1]) / span;
  f = f * f * (3 - 2 * f);
  return { ...base, d: a + (b - a) * f, f, status: "moving" };
}

/** Every train of a line running at time t. */
export function trainsAt(line: SimLine, t: number): NetTrain[] {
  const out: NetTrain[] = [];
  const today = serviceDayStart(t);
  // A service day runs past midnight, so yesterday's late trips can still be out.
  for (const day of [today - DAY_S, today]) {
    const local = t - day;
    for (const svc of servicesOn(line, day)) {
      for (const [pi, s0, s1, hw] of line.frequencies[svc] ?? []) {
        const p = line.patterns[pi];
        if (!p || hw <= 0) continue;
        const dur = p.times[p.times.length - 1][1];
        const k0 = Math.max(0, Math.ceil((local - dur - s0) / hw));
        for (let k = k0; s0 + k * hw < s1 && s0 + k * hw <= local; k++) {
          const tr = place(line, p, pi, day + s0 + k * hw, t);
          if (tr) out.push(tr);
        }
      }
      for (const [pi, s0] of line.trips[svc] ?? []) {
        const p = line.patterns[pi];
        if (!p || s0 > local || local > s0 + p.times[p.times.length - 1][1]) continue;
        const tr = place(line, p, pi, day + s0, t);
        if (tr) out.push(tr);
      }
    }
  }
  return out;
}

export function allTrainsAt(net: SimNetwork, t: number): NetTrain[] {
  return net.lines.flatMap((l) => trainsAt(l, t));
}

/** One train by id, if it is running at time t. */
export function findTrain(net: SimNetwork, id: string, t: number): NetTrain | null {
  const lineId = id.split(":")[1];
  const line = net.lines.find((l) => l.id === lineId);
  return line ? trainsAt(line, t).find((x) => x.id === id) ?? null : null;
}

export function isNetTrain(id: string | null | undefined): boolean {
  return !!id && id.startsWith("net:");
}

/** In tunnel at this distance along the line. */
export function inTunnel(line: SimLine, d: number): boolean {
  return line.tunnels.some(([a, b]) => d > a && d < b);
}

/** Where AERA got a line's trains from, in words. */
export function sourceText(line: SimLine): string {
  if (line.source === "rapid") return "Rapid KL's published timetable (GTFS)";
  if (line.source === "ktmb") return "KTMB's published timetable (GTFS)";
  if (line.source === "estimate") return line.note ?? "Estimated from the operator's published frequency";
  return line.note ?? "No trains run";
}

export interface NetDeparture {
  id: string;
  headsign: string;
  /** Epoch seconds the train leaves the stop. */
  at: number;
}

/** The next trains leaving a stop within `horizonS`, soonest first (TRAINS-04). */
export function departuresAt(line: SimLine, stopIndex: number, t: number, limit = 4, horizonS = 3 * 3600): NetDeparture[] {
  const out: NetDeparture[] = [];
  const today = serviceDayStart(t);
  const add = (p: SimPattern, pi: number, start: number) => {
    const k = p.stops.indexOf(stopIndex);
    if (k < 0 || k === p.stops.length - 1) return;
    const at = start + p.times[k][1];
    if (at >= t && at <= t + horizonS) out.push({ id: `net:${line.id}:${pi}:${start}`, headsign: p.headsign, at });
  };
  for (const day of [today - DAY_S, today, today + DAY_S]) {
    for (const svc of servicesOn(line, day)) {
      for (const [pi, s0, s1, hw] of line.frequencies[svc] ?? []) {
        const p = line.patterns[pi];
        if (!p || hw <= 0) continue;
        const k0 = Math.max(0, Math.ceil((t - horizonS - day - s0) / hw));
        for (let k = k0; s0 + k * hw < s1 && day + s0 + k * hw <= t + horizonS; k++) add(p, pi, day + s0 + k * hw);
      }
      for (const [pi, s0] of line.trips[svc] ?? []) {
        const p = line.patterns[pi];
        if (p) add(p, pi, day + s0);
      }
    }
  }
  out.sort((a, b) => a.at - b.at);
  return out.slice(0, limit);
}

/** First and last departure of the service day containing t, seconds after midnight. */
export function hoursOn(line: SimLine, t: number): [number, number] | null {
  const day = serviceDayStart(t);
  let first = Infinity;
  let last = -Infinity;
  for (const svc of servicesOn(line, day)) {
    for (const [, s0, s1] of line.frequencies[svc] ?? []) {
      first = Math.min(first, s0);
      last = Math.max(last, s1);
    }
    for (const [, s0] of line.trips[svc] ?? []) {
      first = Math.min(first, s0);
      last = Math.max(last, s0);
    }
  }
  return Number.isFinite(first) ? [first, last] : null;
}
