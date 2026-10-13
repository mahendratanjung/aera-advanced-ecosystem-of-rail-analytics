/**
 * Predicted crowding on every line other than the Kelana Jaya Line (NETC-01), from
 * data/models/network.json (built by backend/aera_twin/ridership/network.py).
 *
 * The Kelana Jaya Line has the full engine (lib/crowd/model.ts: live gaps, disruptions, per
 * car). Other lines have a typical-week load per stretch and hour: what a train there usually
 * carries at this time of the week. No disruptions, no per-car split.
 */

import type { NetTrain, SimLine } from "./trains.ts";

const KL_OFFSET_S = 8 * 3600;

export interface NetCrowdModel {
  generated_at: string;
  window: { from: string; to: string; weeks: number };
  source: Record<string, string>;
  capacity: Record<string, number>;
  daytypes: string[];
  /** line -> "from>to" (stop ids, direction of travel) -> day type -> 24 hourly loads (%), null when no train runs. */
  lines: Record<string, Record<string, (number | null)[][]>>;
}

/** 0 weekday, 1 Saturday, 2 Sunday, in KL time. */
export function dayTypeOf(t: number): number {
  const wd = (new Date((t + KL_OFFSET_S) * 1000).getUTCDay() + 6) % 7;
  return wd < 5 ? 0 : wd === 5 ? 1 : 2;
}

function hourOf(t: number): number {
  return ((((t + KL_OFFSET_S) % 86400) + 86400) % 86400) / 3600;
}

/** Hourly loads read at a fractional hour, linear between hour centres, skipping hours without trains. */
function read(row: (number | null)[], h: number): number | null {
  const x = h - 0.5;
  const i = Math.floor(x);
  const f = x - i;
  const a = row[(i + 24) % 24];
  const b = row[(i + 1) % 24];
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a;
  return a + (b - a) * f;
}

/** Typical load (% of capacity) of a train running from one stop to the next at time t. */
export function stretchLoad(m: NetCrowdModel, lineId: string, from: string, to: string, t: number): number | null {
  const row = m.lines[lineId]?.[`${from}>${to}`]?.[dayTypeOf(t)];
  return row ? read(row, hourOf(t)) : null;
}

export function hasCrowding(m: NetCrowdModel | null, lineId: string): boolean {
  return !!m && !!m.lines[lineId];
}

/** Load of a train of another line: the stretch it is on, or about to run along. */
export function netTrainLoad(m: NetCrowdModel | null, tr: NetTrain, t: number): number | null {
  if (!m || tr.next === null) return null;
  return stretchLoad(m, tr.line.id, tr.line.stops[tr.at].id, tr.line.stops[tr.next].id, t);
}

export interface LineNow {
  /** Mean load of the trains running now. */
  mean: number;
  /** The fullest train's load and where it is. */
  max: number;
  from: string;
  to: string;
}

/** How full a line's trains are right now, from the trains running. */
export function lineNow(m: NetCrowdModel, trains: NetTrain[], t: number): LineNow | null {
  let sum = 0;
  let n = 0;
  let best: LineNow | null = null;
  for (const tr of trains) {
    const v = netTrainLoad(m, tr, t);
    if (v === null || tr.next === null) continue;
    sum += v;
    n++;
    if (!best || v > best.max) best = { mean: 0, max: v, from: tr.line.stops[tr.at].name, to: tr.line.stops[tr.next].name };
  }
  return best ? { ...best, mean: sum / n } : null;
}

/** The busiest stretch of a line at one hour on a typical day of this type. */
export function busiestStretch(m: NetCrowdModel, lineId: string, dayType: number, hour: number): { key: string; load: number } | null {
  let best: { key: string; load: number } | null = null;
  for (const [key, days] of Object.entries(m.lines[lineId] ?? {})) {
    const v = days[dayType]?.[hour];
    if (v !== null && v !== undefined && (!best || v > best.load)) best = { key, load: v };
  }
  return best;
}

/** Typical load of trains leaving a stop now, one per destination (from every pattern that calls there). */
export function leavingLoads(m: NetCrowdModel | null, line: SimLine, stopIndex: number, t: number): { headsign: string; load: number }[] {
  if (!m) return [];
  const out = new Map<string, number>();
  for (const p of line.patterns) {
    const k = p.stops.indexOf(stopIndex);
    if (k < 0 || k === p.stops.length - 1 || out.has(p.headsign)) continue;
    const v = stretchLoad(m, line.id, line.stops[stopIndex].id, line.stops[p.stops[k + 1]].id, t);
    if (v !== null) out.set(p.headsign, v);
  }
  return [...out].map(([headsign, load]) => ({ headsign, load }));
}

/** Typical load on the next few stretches of a train's trip, at the times it runs them. */
export function aheadLoads(m: NetCrowdModel | null, tr: NetTrain, n = 6): { from: string; to: string; load: number | null }[] {
  const [, , pi, start] = tr.id.split(":");
  const p = tr.line.patterns[Number(pi)];
  if (!m || !p) return [];
  const j = p.stops.indexOf(tr.at);
  if (j < 0) return [];
  const out = [];
  for (let i = j; i < Math.min(j + n, p.stops.length - 1); i++) {
    const a = tr.line.stops[p.stops[i]];
    const b = tr.line.stops[p.stops[i + 1]];
    out.push({ from: a.name, to: b.name, load: stretchLoad(m, tr.line.id, a.id, b.id, Number(start) + p.times[i][1]) });
  }
  return out;
}
