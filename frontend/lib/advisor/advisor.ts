/**
 * Route advisor (ROUTE-01 to ROUTE-04): what to do when the Kelana Jaya Line is broken.
 *
 * Deterministic and pure, so the assistant can only repeat what this file works out. For a
 * ride it returns up to three kinds of option:
 *
 *   wait     stay on the Kelana Jaya Line and take the first train after it reopens
 *   reroute  go round the blocked section on other Rapid Rail lines (graph search)
 *   road     ride to the edge of the block, bridge the gap by bus or e-hailing, ride on
 *
 * Kelana Jaya legs carry predicted crowding from the crowding engine; legs on other lines carry
 * their typical crowding from the network model when it is given (NETC-05), and say so when
 * not (ERL, BRT). Walking and road times are estimates.
 */

import type { Disruption } from "../types";
import type { CrowdEngine } from "../crowd/model.ts";
import { type NetCrowdModel, stretchLoad } from "../network/crowd.ts";
import { type NetIndex, type NetLine, netHeadway } from "./network.ts";

const KJ = "KJ";
const ROAD_DETOUR = 1.4;
const ROAD_MPS = 22 / 3.6; // city traffic, door to door
const ROAD_WAIT_S = 8 * 60; // waiting for a shuttle bus or an e-hailing car
const ALIGHT_S = 30;
const KJ_SEARCH_S = 25 * 60;

/** Part of the Kelana Jaya Line that trains cannot pass in one direction. */
export interface Block {
  dir: number;
  /** Blocked segments in station order: segment i joins station i and i + 1, lo <= i < hi. */
  lo: number;
  hi: number;
  /** Epoch seconds when trains run again, or null when no end time is set. */
  until: number | null;
  kind: Disruption["kind"];
  stopId: string;
  toStopId: string | null;
  note: string;
}

export interface Leg {
  kind: "ride" | "walk" | "road";
  from: string;
  to: string;
  fromName: string;
  toName: string;
  depart: number;
  arrive: number;
  /** Ride legs only. */
  line?: string;
  lineName?: string;
  color?: string | null;
  headsign?: string;
  stops?: number;
  /** Predicted peak load in percent on this leg, or null when there is no crowding data. */
  crowd?: number | null;
  /** True when the time is an estimate (walking, road, other lines, trains after a block). */
  estimate: boolean;
}

export interface RouteOption {
  id: string;
  kind: "wait" | "reroute" | "road" | "direct";
  title: string;
  depart: number;
  arrive: number;
  legs: Leg[];
  /** Highest predicted load on any ride leg, null when none are predicted. */
  peak: number | null;
  note: string;
}

export interface Advice {
  /** The disruption that breaks this ride, or null when the ride is fine. */
  block: Block | null;
  options: RouteOption[];
}

// ---- blocks ---------------------------------------------------------------------------------

/** Sections of the Kelana Jaya Line that trains cannot pass at time t. */
export function blocksAt(engine: CrowdEngine, disruptions: Disruption[], t: number): Block[] {
  const idx = engine.idx;
  const out: Block[] = [];
  for (const d of disruptions) {
    if (d.kind !== "hold" && d.kind !== "suspend") continue;
    const start = d.start_ms / 1000;
    const end = d.end_ms === null ? null : d.end_ms / 1000;
    if (start > t || (end !== null && end <= t)) continue;
    const a = idx[d.stop_id];
    const b = d.to_stop_id ? idx[d.to_stop_id] : a;
    if (a === undefined || b === undefined) continue;
    const dirs = d.direction_id === null ? [0, 1] : [d.direction_id];
    for (const dir of dirs) {
      let lo: number;
      let hi: number;
      if (a !== b) {
        lo = Math.min(a, b);
        hi = Math.max(a, b);
      } else {
        // Held at one station: the leg leaving it. Direction 1 runs in station order.
        lo = dir === 1 ? a : a - 1;
        hi = lo + 1;
      }
      if (lo < 0 || hi > engine.data.stations.length - 1) continue;
      out.push({ dir, lo, hi, until: end, kind: d.kind, stopId: d.stop_id, toStopId: d.to_stop_id, note: d.note });
    }
  }
  return out;
}

/** The block a Kelana Jaya ride from o to d runs into, if any. */
export function rideBlock(engine: CrowdEngine, blocks: Block[], o: string, d: string): Block | null {
  const io = engine.idx[o];
  const id = engine.idx[d];
  if (io === undefined || id === undefined || io === id) return null;
  const dir = id > io ? 1 : 0;
  const [a, b] = io < id ? [io, id] : [id, io];
  return blocks.find((k) => k.dir === dir && k.lo < b && k.hi > a) ?? null;
}

function segBlocked(blocks: Block[], dir: number, seg: number): boolean {
  return blocks.some((k) => k.dir === dir && seg >= k.lo && seg < k.hi);
}

// ---- graph search ---------------------------------------------------------------------------

type Edge = { to: string; kind: "board" | "ride" | "alight" | "walk"; line: NetLine; dir: number; cost: number };

const graphs = new WeakMap<NetIndex, Map<string, Edge[]>>();

/** Nodes: "STOP" is standing at a station, "STOP|dir" is on board a train of that stop's line. */
function graph(ix: NetIndex): Map<string, Edge[]> {
  let g = graphs.get(ix);
  if (g) return g;
  g = new Map();
  const add = (from: string, e: Edge) => {
    if (!g!.has(from)) g!.set(from, []);
    g!.get(from)!.push(e);
  };
  for (const line of ix.net.lines) {
    for (const d of line.directions) {
      const s = d.stops;
      for (let i = 0; i < s.length; i++) {
        const on = `${s[i].id}|${d.direction_id}`;
        if (i < s.length - 1) {
          add(s[i].id, { to: on, kind: "board", line, dir: d.direction_id, cost: 0 });
          add(on, { to: `${s[i + 1].id}|${d.direction_id}`, kind: "ride", line, dir: d.direction_id, cost: Math.max(30, s[i + 1].dep - s[i].dep) });
        }
        if (i > 0) add(on, { to: s[i].id, kind: "alight", line, dir: d.direction_id, cost: ALIGHT_S });
      }
    }
  }
  for (const tr of ix.net.transfers) {
    const a = ix.stop[tr.from];
    const b = ix.stop[tr.to];
    if (!a || !b) continue;
    add(tr.from, { to: tr.to, kind: "walk", line: b.line, dir: 0, cost: tr.walk_s });
    add(tr.to, { to: tr.from, kind: "walk", line: a.line, dir: 0, cost: tr.walk_s });
  }
  graphs.set(ix, g);
  return g;
}

/** Earliest-arrival search from o to d leaving at t. Returns the node path or null. */
function search(ix: NetIndex, engine: CrowdEngine, blocks: Block[], o: string, d: string, t: number,
  avoidLines: Set<string>): string[] | null {
  const g = graph(ix);
  const best = new Map<string, number>([[o, t]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();
  const open: string[] = [o];
  while (open.length) {
    let k = 0;
    for (let i = 1; i < open.length; i++) if (best.get(open[i])! < best.get(open[k])!) k = i;
    const u = open.splice(k, 1)[0];
    if (done.has(u)) continue;
    done.add(u);
    if (u === d) break;
    const tu = best.get(u)!;
    for (const e of g.get(u) ?? []) {
      if (done.has(e.to)) continue;
      let cost = e.cost;
      if (e.kind === "board") {
        if (avoidLines.has(e.line.id)) continue;
        const hw = netHeadway(e.line, e.dir, tu);
        if (hw === null) continue;
        cost = hw / 2;
      }
      if (e.kind === "ride" && e.line.id === KJ) {
        const a = engine.idx[u.split("|")[0]];
        const b = engine.idx[e.to.split("|")[0]];
        if (a === undefined || b === undefined || segBlocked(blocks, e.dir, Math.min(a, b))) continue;
      }
      const tv = tu + cost;
      if (tv < (best.get(e.to) ?? Infinity)) {
        best.set(e.to, tv);
        prev.set(e.to, u);
        open.push(e.to);
      }
    }
  }
  if (!done.has(d)) return null;
  const path = [d];
  while (path[0] !== o) path.unshift(prev.get(path[0])!);
  return path;
}

// ---- legs and timing ------------------------------------------------------------------------

type Step = { kind: "ride"; line: NetLine; dir: number; from: string; to: string; stops: number }
  | { kind: "walk"; from: string; to: string; seconds: number }
  | { kind: "road"; from: string; to: string };

function stepsOf(ix: NetIndex, path: string[]): Step[] {
  const steps: Step[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const [a, b] = [path[i], path[i + 1]];
    if (!a.includes("|") && b.includes("|")) {
      const [sid, dir] = b.split("|");
      let j = i + 1;
      while (j + 1 < path.length && path[j + 1].includes("|")) j++;
      const end = path[j].split("|")[0];
      steps.push({ kind: "ride", line: ix.stop[sid].line, dir: Number(dir), from: sid, to: end, stops: j - i - 1 });
      i = j; // the alight edge lands on path[j + 1], the same station standing
    } else if (!a.includes("|") && !b.includes("|") && a !== b) {
      const tr = ix.net.transfers.find((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a));
      steps.push({ kind: "walk", from: a, to: b, seconds: tr?.walk_s ?? 300 });
    }
  }
  return steps;
}

function roadSeconds(ix: NetIndex, a: string, b: string): number {
  const p = ix.stop[a];
  const q = ix.stop[b];
  const dy = (q.lat - p.lat) * 110_540;
  const dx = (q.lon - p.lon) * 111_320 * Math.cos((p.lat * Math.PI) / 180);
  return ROAD_WAIT_S + (Math.hypot(dx, dy) * ROAD_DETOUR) / ROAD_MPS;
}

/** Turn steps into timed legs, using the crowding engine's real trains on the Kelana Jaya Line. */
function timeLegs(ix: NetIndex, engine: CrowdEngine, steps: Step[], t: number, disruptions: Disruption[], mult: number,
  kjWindowS = KJ_SEARCH_S, netCrowd: NetCrowdModel | null = null): Leg[] {
  const legs: Leg[] = [];
  let cursor = t;
  const name = (id: string) => ix.stop[id]?.name ?? id;
  for (const s of steps) {
    if (s.kind === "walk") {
      legs.push({ kind: "walk", from: s.from, to: s.to, fromName: name(s.from), toName: name(s.to), depart: cursor, arrive: cursor + s.seconds, estimate: true });
      cursor += s.seconds;
      continue;
    }
    if (s.kind === "road") {
      const sec = roadSeconds(ix, s.from, s.to);
      legs.push({ kind: "road", from: s.from, to: s.to, fromName: name(s.from), toName: name(s.to), depart: cursor, arrive: cursor + sec, estimate: true });
      cursor += sec;
      continue;
    }
    const dirInfo = s.line.directions.find((d) => d.direction_id === s.dir)!;
    const base = { kind: "ride" as const, from: s.from, to: s.to, fromName: name(s.from), toName: name(s.to), line: s.line.id,
      lineName: s.line.name, color: s.line.color, headsign: dirInfo.headsign, stops: s.stops };
    if (s.line.id === KJ) {
      const trip = engine.trip(s.from, s.to, cursor, disruptions, mult, kjWindowS);
      const first = trip?.options[0];
      if (first) {
        legs.push({ ...base, depart: first.depart, arrive: first.arrive, crowd: first.peak, estimate: false });
        cursor = first.arrive;
        continue;
      }
    }
    // Other lines, or Kelana Jaya trains beyond a block that the timetable cannot place.
    const ia = dirInfo.stops.findIndex((x) => x.id === s.from);
    const ib = dirInfo.stops.findIndex((x) => x.id === s.to);
    const ride = ia >= 0 && ib > ia ? dirInfo.stops[ib].arr - dirInfo.stops[ia].dep : s.stops * 120;
    const wait = (netHeadway(s.line, s.dir, cursor) ?? 600) / 2;
    legs.push({ ...base, depart: cursor + wait, arrive: cursor + wait + ride, crowd: legCrowd(netCrowd, s.line.id, dirInfo.stops, ia, ib, cursor + wait), estimate: true });
    cursor += wait + ride;
  }
  return legs;
}

/** NETC-05: the fullest stretch of a ride on another line, at the times the train runs it. */
function legCrowd(m: NetCrowdModel | null, lineId: string, stops: { id: string; dep: number }[], ia: number, ib: number, depart: number): number | null {
  if (!m || ia < 0 || ib <= ia) return null;
  let peak: number | null = null;
  for (let k = ia; k < ib; k++) {
    const v = stretchLoad(m, lineId, stops[k].id, stops[k + 1].id, depart + stops[k].dep - stops[ia].dep);
    if (v !== null) peak = Math.max(peak ?? 0, v);
  }
  return peak;
}

function peakOf(legs: Leg[]): number | null {
  const v = legs.filter((l) => l.kind === "ride" && typeof l.crowd === "number").map((l) => l.crowd as number);
  return v.length ? Math.max(...v) : null;
}

function option(id: string, kind: RouteOption["kind"], title: string, legs: Leg[], t: number, note: string): RouteOption | null {
  // A walk between two platforms of the same station at either end is not part of the ride
  // (ending at Tun Razak Exchange on the Putrajaya Line is arriving there).
  const sameStation = (l: Leg) => l.kind === "walk" && l.fromName === l.toName;
  while (legs.length && sameStation(legs[legs.length - 1])) legs = legs.slice(0, -1);
  while (legs.length && sameStation(legs[0])) legs = legs.slice(1);
  if (!legs.length) return null;
  return { id, kind, title, depart: legs[0].depart ?? t, arrive: legs[legs.length - 1].arrive, legs, peak: peakOf(legs), note };
}

function linesOf(legs: Leg[]): string[] {
  return legs.filter((l) => l.kind === "ride" && l.line !== KJ).map((l) => l.line!);
}

// ---- advice ---------------------------------------------------------------------------------

/**
 * How to get from o to d (network stop ids) at time t. When both are Kelana Jaya stations and
 * the ride is not blocked, block is null and the only option is the direct ride.
 */
export function advise(ix: NetIndex, engine: CrowdEngine, o: string, d: string, t: number, disruptions: Disruption[], mult = 1,
  netCrowd: NetCrowdModel | null = null): Advice {
  if (o === d || !ix.stop[o] || !ix.stop[d]) return { block: null, options: [] };
  const blocks = blocksAt(engine, disruptions, t);
  const bothKJ = o in engine.idx && d in engine.idx;
  const block = bothKJ ? rideBlock(engine, blocks, o, d) : null;
  const options: RouteOption[] = [];

  if (bothKJ && !block) {
    const legs = timeLegs(ix, engine, [{ kind: "ride", line: ix.line[KJ], dir: engine.idx[d] > engine.idx[o] ? 1 : 0, from: o, to: d, stops: Math.abs(engine.idx[d] - engine.idx[o]) }], t, disruptions, mult, KJ_SEARCH_S, netCrowd);
    const o1 = option("direct", "direct", "Kelana Jaya Line", legs, t, "");
    return { block: null, options: o1 ? [o1] : [] };
  }

  // 1. Wait for the line to reopen.
  if (block && block.until !== null) {
    const window = block.until - t + 3600;
    const trip = engine.trip(o, d, t, disruptions, mult, window);
    const first = trip?.options[0];
    if (first) {
      const dirInfo = ix.line[KJ].directions.find((x) => x.direction_id === trip!.dir)!;
      const legs: Leg[] = [{ kind: "ride", from: o, to: d, fromName: ix.stop[o].name, toName: ix.stop[d].name, line: KJ,
        lineName: ix.line[KJ].name, color: ix.line[KJ].color, headsign: dirInfo.headsign, stops: Math.abs(engine.idx[d] - engine.idx[o]),
        depart: first.depart, arrive: first.arrive, crowd: first.peak, estimate: false }];
      const w = option("wait", "wait", "Wait for the line to reopen", legs, t,
        "The first trains after a stoppage are the fullest. Waiting one more train is usually calmer.");
      if (w) options.push(w);
    }
  }

  // 2. Go round on other lines: the fastest way, then the fastest that avoids its first line.
  const avoid = new Set<string>();
  const seen = new Set<string>();
  for (let i = 0; i < 3 && options.filter((x) => x.kind === "reroute").length < 2; i++) {
    const path = search(ix, engine, blocks, o, d, t, avoid);
    if (!path) break;
    const legs = timeLegs(ix, engine, stepsOf(ix, path), t, disruptions, mult, KJ_SEARCH_S, netCrowd);
    const others = linesOf(legs);
    const key = legs.map((l) => `${l.kind}:${l.line ?? ""}:${l.from}:${l.to}`).join(">");
    if (!seen.has(key) && (others.length || !block)) {
      seen.add(key);
      const via = [...new Set(legs.filter((l) => l.kind === "ride").map((l) => ix.line[l.line!]?.name ?? l.line!))];
      const r = option(`route-${i}`, block ? "reroute" : "direct", block ? `Go round via ${via.filter((n) => n !== ix.line[KJ].name).join(" and ")}` : via.join(", then "), legs, t,
        others.length ? netCrowd ? "Crowding on other lines is what their trains usually carry at this hour. Walking times between lines are estimates." : "No crowding prediction for other lines. Walking times between lines are estimates." : "");
      if (r) options.push(r);
    }
    if (!others.length) break;
    avoid.add(others[0]);
  }

  // 3. Bridge the gap by road.
  if (block) {
    const io = engine.idx[o];
    const id = engine.idx[d];
    const st = engine.data.stations;
    const dir = id > io ? 1 : 0;
    // Station-order positions where the ride enters and leaves the blocked section.
    const enter = dir === 1 ? Math.max(io, block.lo) : Math.min(io, block.hi);
    const leave = dir === 1 ? Math.min(id, block.hi) : Math.max(id, block.lo);
    const steps: Step[] = [];
    if (enter !== io) steps.push({ kind: "ride", line: ix.line[KJ], dir, from: o, to: st[enter], stops: Math.abs(enter - io) });
    steps.push({ kind: "road", from: st[enter], to: st[leave] });
    if (leave !== id) steps.push({ kind: "ride", line: ix.line[KJ], dir, from: st[leave], to: d, stops: Math.abs(id - leave) });
    const legs = timeLegs(ix, engine, steps, t, disruptions, mult, KJ_SEARCH_S, netCrowd);
    const r = option("road", "road", `Bus or e-hailing between ${ix.stop[st[enter]].name} and ${ix.stop[st[leave]].name}`, legs, t,
      "Rapid KL often runs free shuttle buses during long stoppages; check station announcements. Road times are estimates.");
    if (r) options.push(r);
  }

  options.sort((a, b) => a.arrive - b.arrive);
  return { block, options };
}
