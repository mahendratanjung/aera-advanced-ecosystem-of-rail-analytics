/**
 * Turns the poster data (schematic.ts) into drawable geometry: rounded line paths, a sampled
 * polyline per line (so trains can be placed by distance along it), interchange outlines and
 * label positions. Pure and memoised, so the map, the tests and the search share one layout.
 */

import { BOUNDS, type BendDef, LINES, LINKS, type LabelSpec, type LineDef, NODES, type NodeDef, type Pt, type StationDef } from "./schematic.ts";

export const FONT = 4.2;
export const FONT_NODE = 4.5;
export const LINE_W = 2.6;
const LINE_H = 1.18;
const CHAR_W = 0.56; // average glyph width as a share of the font size

export interface Station extends StationDef {
  line: LineDef;
  /** Display name on one line. */
  plain: string;
  node: NodeDef | null;
  /** Distance along the line's drawn path, map units. */
  s: number;
}

export interface Label {
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  lines: string[];
  size: number;
  bold: boolean;
  box: { x: number; y: number; w: number; h: number };
}

export interface Place {
  /** Node name or the station id when it is not an interchange. */
  key: string;
  name: string;
  stations: Station[];
  box: { x: number; y: number; w: number; h: number };
  center: Pt;
  label: Label | null;
  hub: NodeDef["hub"] | null;
  terminus: boolean;
}

export interface LaidLine {
  def: LineDef;
  d: string;
  pts: Pt[];
  cum: number[];
  length: number;
  stations: Station[];
}

export interface Layout {
  lines: LaidLine[];
  line: Record<string, LaidLine>;
  station: Record<string, Station>;
  places: Place[];
  placeOf: Record<string, Place>;
  links: { a: Station; b: Station }[];
  bounds: typeof BOUNDS;
}

const isBend = (e: StationDef | BendDef): e is BendDef => "bend" in e;
export const plainName = (name: string) => name.replace(/\s*\n\s*/g, " ").replace(/–\s/g, "–").trim();

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const len = (v: Pt) => Math.hypot(v[0], v[1]);
const along = (p: Pt, v: Pt, d: number): Pt => {
  const l = len(v) || 1;
  return [p[0] + (v[0] / l) * d, p[1] + (v[1] / l) * d];
};
const r1 = (n: number) => Math.round(n * 100) / 100;

/** The drawn path: straight runs with each bend rounded by a quadratic curve. */
function trace(vs: { p: Pt; r: number }[]): { d: string; pts: Pt[] } {
  const pts: Pt[] = [vs[0].p];
  let d = `M${r1(vs[0].p[0])} ${r1(vs[0].p[1])}`;
  for (let i = 1; i < vs.length; i++) {
    const { p, r } = vs[i];
    const next = vs[i + 1];
    if (!next || r <= 0) {
      d += `L${r1(p[0])} ${r1(p[1])}`;
      pts.push(p);
      continue;
    }
    const inV = sub(vs[i - 1].p, p);
    const outV = sub(next.p, p);
    const rr = Math.min(r, len(inV) / 2, len(outV) / 2);
    const a = along(p, inV, rr);
    const b = along(p, outV, rr);
    d += `L${r1(a[0])} ${r1(a[1])}Q${r1(p[0])} ${r1(p[1])} ${r1(b[0])} ${r1(b[1])}`;
    pts.push(a);
    for (let k = 1; k <= 6; k++) {
      const t = k / 6;
      const u = 1 - t;
      pts.push([u * u * a[0] + 2 * u * t * p[0] + t * t * b[0], u * u * a[1] + 2 * u * t * p[1] + t * t * b[1]]);
    }
  }
  return { d, pts };
}

function cumulative(pts: Pt[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + len(sub(pts[i], pts[i - 1])));
  return cum;
}

/** Distance along the polyline of the point nearest to p. */
function project(pts: Pt[], cum: number[], p: Pt): number {
  let best = Infinity;
  let at = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const ab = sub(pts[i], a);
    const l2 = ab[0] ** 2 + ab[1] ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2));
    const q: Pt = [a[0] + ab[0] * t, a[1] + ab[1] * t];
    const dist = len(sub(p, q));
    if (dist < best - 1e-9) {
      best = dist;
      at = cum[i - 1] + Math.sqrt(l2) * t;
    }
  }
  return at;
}

/** Point and heading at distance s along a laid line. */
export function pointAt(line: LaidLine, s: number): { p: Pt; dir: Pt } {
  const { pts, cum } = line;
  const x = Math.max(0, Math.min(line.length, s));
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= x) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const t = (x - cum[lo]) / seg;
  const a = pts[lo];
  const b = pts[hi];
  const v = sub(b, a);
  const l = len(v) || 1;
  return { p: [a[0] + v[0] * t, a[1] + v[1] * t], dir: [v[0] / l, v[1] / l] };
}

/** The part of a line between two distances, for marking a stretch. */
export function slice(line: LaidLine, s0: number, s1: number): Pt[] {
  const [a, b] = s0 <= s1 ? [s0, s1] : [s1, s0];
  const out: Pt[] = [pointAt(line, a).p];
  line.cum.forEach((c, i) => {
    if (c > a && c < b) out.push(line.pts[i]);
  });
  out.push(pointAt(line, b).p);
  return out;
}

function parseSpec(spec: LabelSpec | undefined): { side: string; d: number } | { dx: number; dy: number; anchor: Label["anchor"] } {
  if (Array.isArray(spec)) return { dx: spec[0], dy: spec[1], anchor: spec[2] };
  const [side, d] = (spec ?? "r").split(":");
  return { side, d: d ? Number(d) : side === "t" || side === "b" ? 4.5 : 4 };
}

export function placeLabel(text: string, spec: LabelSpec | undefined, box: Place["box"], size: number, bold: boolean): Label {
  const lines = text.split("\n").map((l) => l.trim());
  const h = size * LINE_H;
  const blockH = h * lines.length;
  const w = Math.max(...lines.map((l) => l.length)) * size * CHAR_W * (bold ? 1.06 : 1);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const p = parseSpec(spec);
  let x: number;
  let top: number;
  let anchor: Label["anchor"];
  if ("dx" in p) {
    x = cx + p.dx;
    top = cy + p.dy - blockH / 2;
    anchor = p.anchor;
  } else if (p.side === "l") {
    x = box.x - p.d;
    top = cy - blockH / 2;
    anchor = "end";
  } else if (p.side === "t") {
    x = cx;
    top = box.y - p.d - blockH;
    anchor = "middle";
  } else if (p.side === "b") {
    x = cx;
    top = box.y + box.h + p.d;
    anchor = "middle";
  } else {
    x = box.x + box.w + p.d;
    top = cy - blockH / 2;
    anchor = "start";
  }
  const left = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
  // Baseline of the first line: glyphs sit about 0.78 of the size below the line's top.
  return { x: r1(x), y: r1(top + size * 0.86), anchor, lines, size, bold, box: { x: left, y: top, w, h: blockH } };
}

let cached: Layout | null = null;

export function layout(): Layout {
  if (cached) return cached;
  const nodeOf: Record<string, NodeDef> = {};
  for (const n of NODES) for (const id of n.ids) nodeOf[id] = n;

  const station: Record<string, Station> = {};
  const lines: LaidLine[] = LINES.map((def) => {
    const vs = def.path.map((e) => (isBend(e) ? { p: e.bend, r: e.r ?? 6 } : { p: e.at, r: 0 }));
    const { d, pts } = trace(vs);
    const cum = cumulative(pts);
    const stations = def.path.filter((e): e is StationDef => !isBend(e)).map((e) => {
      const s: Station = { ...e, line: def, plain: plainName(e.name), node: nodeOf[e.id] ?? null, s: project(pts, cum, e.at) };
      station[e.id] = s;
      return s;
    });
    return { def, d, pts, cum, length: cum[cum.length - 1], stations };
  });

  const linked = new Set(LINKS.flat());
  const termini = new Set(lines.flatMap((l) => [l.stations[0].id, l.stations[l.stations.length - 1].id]));
  const places: Place[] = [];
  const placeOf: Record<string, Place> = {};
  const pad = 2.6;
  for (const n of NODES) {
    const members = n.ids.map((id) => station[id]);
    const xs = members.map((m) => m.at[0]);
    const ys = members.map((m) => m.at[1]);
    const box = n.hub
      ? { ...n.hub }
      : { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + 2 * pad, h: Math.max(...ys) - Math.min(...ys) + 2 * pad };
    const place: Place = {
      key: plainName(n.name), name: plainName(n.name), stations: members, box,
      center: [box.x + box.w / 2, box.y + box.h / 2], hub: n.hub ?? null, terminus: members.some((m) => termini.has(m.id)),
      label: placeLabel(n.name, n.lab, box, FONT_NODE, true),
    };
    places.push(place);
    for (const m of members) placeOf[m.id] = place;
  }
  for (const l of lines) {
    for (const s of l.stations) {
      if (placeOf[s.id]) continue;
      const terminus = termini.has(s.id);
      const bold = terminus || linked.has(s.id);
      const box = { x: s.at[0] - 1.3, y: s.at[1] - 1.3, w: 2.6, h: 2.6 };
      const size = terminus ? FONT_NODE + 0.6 : bold ? FONT_NODE : FONT;
      const place: Place = { key: s.id, name: s.plain, stations: [s], box, center: s.at, hub: null, terminus, label: placeLabel(s.name, s.lab, box, size, bold) };
      places.push(place);
      placeOf[s.id] = place;
    }
  }

  cached = {
    lines,
    line: Object.fromEntries(lines.map((l) => [l.def.id, l])),
    station,
    places,
    placeOf,
    links: LINKS.map(([a, b]) => ({ a: station[a], b: station[b] })),
    bounds: BOUNDS,
  };
  return cached;
}

/** Places reachable on foot from this one, through the walkways on the poster. */
export function linkedPlaces(lay: Layout, place: Place): Place[] {
  const ids = new Set(place.stations.map((s) => s.id));
  const out: Place[] = [];
  for (const { a, b } of lay.links) {
    const other = ids.has(a.id) ? b : ids.has(b.id) ? a : null;
    if (other) {
      const p = lay.placeOf[other.id];
      if (p !== place && !out.includes(p)) out.push(p);
    }
  }
  return out;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Station search across every line: codes, names and words in names. */
export function searchPlaces(lay: Layout, q: string, limit = 8): Place[] {
  const k = norm(q);
  if (!k) return [];
  const scored = lay.places
    .map((p) => {
      const n = norm(p.name);
      const code = p.stations.some((s) => norm(s.id) === k);
      const word = p.name.split(/\s+/).some((w) => norm(w).startsWith(k));
      const score = code ? 0 : n.startsWith(k) ? 1 : word ? 2 : n.includes(k) ? 3 : 9;
      return { p, score };
    })
    .filter((x) => x.score < 9)
    .sort((a, b) => a.score - b.score || b.p.stations.length - a.p.stations.length || a.p.name.localeCompare(b.p.name));
  return scored.slice(0, limit).map((x) => x.p);
}

const key = (s: string) => norm(plainName(s).replace(/\/.*$/, ""));

/**
 * The map station for a stop of a timetabled line (TRAINS-03). Rapid Rail and ERL stops carry
 * the map's own ids; KTM stops are matched by name within their line.
 */
export function stationFor(lay: Layout, lineId: string, stop: { id: string; name: string }): Station | null {
  const direct = lay.station[stop.id];
  if (direct && direct.line.id === lineId) return direct;
  const line = lay.line[lineId];
  return line?.stations.find((s) => key(s.plain) === key(stop.name)) ?? null;
}

/**
 * The timetables with the map's station names (GTFS has "Pwtc", "Upm", "Sunu-Monash"), and
 * headsigns to match. Lines and stops keep their ids.
 */
export function withMapNames<N extends { lines: { id: string; stops: { id: string; name: string }[]; patterns: { headsign: string; stops: number[] }[] }[] }>(lay: Layout, net: N): N {
  return {
    ...net,
    lines: net.lines.map((l) => {
      const stops = l.stops.map((s) => ({ ...s, name: stationFor(lay, l.id, s)?.plain ?? s.name }));
      const patterns = l.patterns.map((p) => ({ ...p, headsign: stops[p.stops[p.stops.length - 1]]?.name ?? p.headsign }));
      return { ...l, stops, patterns };
    }),
  };
}
