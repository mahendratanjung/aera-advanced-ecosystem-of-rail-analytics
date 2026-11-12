"use client";

/**
 * The integrated transit map (NETM-01 to NETM-04) as an interactive SVG: drag or pinch to
 * pan, wheel or pinch to zoom, tap a station or a train. Lines, interchanges and labels are
 * drawn once from the layout; only the view transform and the live Kelana Jaya trains change,
 * and both are written straight to the DOM so panning never re-renders React.
 *
 * Labels appear as you zoom in (interchanges and termini first), as on a printed map viewed
 * from further away.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { blocksAt } from "@/lib/advisor/advisor";
import { crowdOf, crowdVar } from "@/lib/crowd/levels";
import { subscribe } from "@/lib/crowd/feed";
import type { CrowdEngine } from "@/lib/crowd/model";
import { useNetCrowd, useSimNow } from "@/lib/hooks";
import { netTrainLoad } from "@/lib/network/crowd";
import { LINE_W, type LaidLine, type Layout, type Place, pointAt, slice, stationFor } from "@/lib/network/layout";
import { type SimNetwork, trainsAt } from "@/lib/network/trains";
import type { Pt } from "@/lib/network/schematic";
import { NO_DISRUPTIONS, useTwin } from "@/lib/store";
import type { LineData } from "@/lib/types";

export interface MapHandle {
  fit: () => void;
  zoom: (factor: number) => void;
  focus: (at: Pt, minK?: number) => void;
}

export interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface View {
  k: number;
  tx: number;
  ty: number;
}


/** Smallest a station name is drawn on screen, in pixels (phones see the whole map at once). */
const MIN_LABEL_PX = 8;

interface ShownLabel {
  x: number;
  y: number;
  size: number;
  anchor: "start" | "middle" | "end";
  lines: string[];
  bold: boolean;
}

/**
 * Station names at the current zoom (user feedback, 13 Nov 2026: on phones the whole-map view
 * had no names). Each name is drawn at least MIN_LABEL_PX tall; names are placed in order of
 * importance (interchanges, then termini, then the rest) and any that would overlap one
 * already placed is left out, so zooming in brings more names in without clutter.
 */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * What an enlarged name must not cover: points along every line (spaced well under a line
 * width, padded by half the line), each station marker and each line-number badge. Built once.
 */
function obstaclesOf(lay: Layout): { points: Pt[]; boxes: { key: string; b: Box }[] } {
  const points: Pt[] = [];
  const step = LINE_W * 0.6;
  for (const l of lay.lines) {
    for (let i = 1; i < l.pts.length; i++) {
      const [ax, ay] = l.pts[i - 1];
      const [bx, by] = l.pts[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
      for (let j = 0; j <= n; j++) points.push([ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n]);
    }
  }
  const boxes = lay.places.map((p) => ({ key: p.key, b: { x0: p.box.x, y0: p.box.y, x1: p.box.x + p.box.w, y1: p.box.y + p.box.h } }));
  for (const l of lay.lines) for (const [x, y] of l.def.badges) boxes.push({ key: "", b: { x0: x - 4.6, y0: y - 4.6, x1: x + 4.6, y1: y + 4.6 } });
  return { points, boxes };
}

const hits = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

function labelsAt(places: Place[], k: number, bounds: Layout["bounds"], obstacles: ReturnType<typeof obstaclesOf>): Map<string, ShownLabel> {
  const rank = (p: Place) => (p.hub ? 0 : p.stations.length > 1 ? 1 : p.terminus ? 2 : p.label?.bold ? 3 : 4);
  const order = places.filter((p) => p.label).sort((a, b) => rank(a) - rank(b));
  const pad = 2 / k;
  const taken: Box[] = [];
  const out = new Map<string, ShownLabel>();
  for (const p of order) {
    const l = p.label!;
    const f = Math.max(1, MIN_LABEL_PX / (l.size * k));
    const w = l.box.w * f;
    const h = l.box.h * f;
    // Grow away from the station: keep the edge next to it, or the middle for side labels.
    const above = l.box.y + l.box.h <= p.box.y + 0.01;
    const below = l.box.y >= p.box.y + p.box.h - 0.01;
    const top = above ? l.box.y + l.box.h - h : below ? l.box.y : l.box.y + l.box.h / 2 - h / 2;
    // A name that would run off the map's edge goes on the other side of its station.
    let x = l.x;
    let anchor = l.anchor;
    const leftOf = (ax: number, an: ShownLabel["anchor"]) => (an === "start" ? ax : an === "end" ? ax - w : ax - w / 2);
    const outside = (ax: number, an: ShownLabel["anchor"]) => leftOf(ax, an) < bounds.x || leftOf(ax, an) + w > bounds.x + bounds.w;
    // Enlarged names must not sit on a line, another station or a badge; one that cannot be
    // placed clear on either side of its station is left out until the map is zoomed in.
    const clear = (ax: number, an: ShownLabel["anchor"]) => {
      if (outside(ax, an)) return null;
      const left = leftOf(ax, an);
      const b: Box = { x0: left - pad, y0: top - pad, x1: left + w + pad, y1: top + h + pad };
      if (taken.some((t) => hits(b, t))) return null;
      if (f > 1) {
        const m = LINE_W / 2;
        // The station's own lines and end-of-line badge, right at the station, do not count.
        const g = Math.max(LINE_W * 2.5, 12 / k);
        const own: Box = { x0: p.box.x - g, y0: p.box.y - g, x1: p.box.x + p.box.w + g, y1: p.box.y + p.box.h + g };
        const near = (px: number, py: number) => px > own.x0 && px < own.x1 && py > own.y0 && py < own.y1;
        if (obstacles.points.some(([px, py]) => !near(px, py) && px > b.x0 - m && px < b.x1 + m && py > b.y0 - m && py < b.y1 + m)) return null;
        // Badges are never covered. A name may touch the edge of its own line's end badge, but
        // not its number (the badge sits just past the end-of-line station).
        const end: Box = { x0: p.box.x - 16, y0: p.box.y - 16, x1: p.box.x + p.box.w + 16, y1: p.box.y + p.box.h + 16 };
        const core = (o: Box): Box => ({ x0: o.x0 + 3.4, y0: o.y0 + 3.4, x1: o.x1 - 3.4, y1: o.y1 - 3.4 });
        if (obstacles.boxes.some((o) => o.key !== p.key && hits(b, o.key === "" && p.terminus && hits(o.b, end) ? core(o.b) : o.b))) return null;
      }
      return b;
    };
    let box = clear(x, anchor);
    if (!box && f > 1 && anchor !== "middle") {
      const fx = anchor === "start" ? p.box.x - (l.x - (p.box.x + p.box.w)) : p.box.x + p.box.w + (p.box.x - l.x);
      const fa = anchor === "start" ? "end" : "start";
      box = clear(fx, fa);
      if (box) {
        x = fx;
        anchor = fa;
      }
    }
    if (!box) {
      // At the drawn size the hand-placed layout is kept as it is.
      if (f > 1) continue;
      const left = leftOf(x, anchor);
      box = { x0: left - pad, y0: top - pad, x1: left + w + pad, y1: top + h + pad };
    }
    taken.push(box);
    const size = l.size * f;
    out.set(p.key, { x, y: top + size * 0.86, size, anchor, lines: l.lines, bold: l.bold });
  }
  return out;
}

function pathOf(pts: Pt[]): string {
  return pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join("");
}

/** Where each Kelana Jaya station sits along the drawn line, by track distance. */
function trackToMap(kj: LaidLine, line: LineData) {
  const pairs = line.stations
    .map((s) => ({ m: s.distance_m, s: kj.stations.find((x) => x.id === s.id)?.s }))
    .filter((p): p is { m: number; s: number } => p.s !== undefined)
    .sort((a, b) => a.m - b.m);
  const inc: Record<number, boolean> = {};
  for (const d of line.directions) {
    const first = line.stations.find((s) => s.id === d.stops[0].station_id)!;
    const last = line.stations.find((s) => s.id === d.stops[d.stops.length - 1].station_id)!;
    inc[d.direction_id] = last.distance_m > first.distance_m;
  }
  const sUp = pairs[pairs.length - 1].s > pairs[0].s;
  const at = (m: number): number => {
    if (m <= pairs[0].m) return pairs[0].s;
    for (let i = 1; i < pairs.length; i++) {
      if (m <= pairs[i].m) {
        const f = (m - pairs[i - 1].m) / (pairs[i].m - pairs[i - 1].m || 1);
        return pairs[i - 1].s + (pairs[i].s - pairs[i - 1].s) * f;
      }
    }
    return pairs[pairs.length - 1].s;
  };
  return { at, sign: (dir: number) => ((inc[dir] ?? true) === sUp ? 1 : -1) };
}

export const NetworkMap = forwardRef<MapHandle, {
  lay: Layout;
  focusLine: string | null;
  selected: string | null;
  onSelect: (key: string | null) => void;
  selectedTrain: string | null;
  onTrain: (trip: string) => void;
  engine: CrowdEngine | null;
  line: LineData | null;
  /** Timetables of the other lines, for their trains. */
  net: SimNetwork | null;
  showTrains: boolean;
  inset: Inset;
  /** Where to look first when the map opens (otherwise the whole map). */
  start?: { at: Pt; k: number } | null;
}>(function NetworkMap({ lay, focusLine, selected, onSelect, selectedTrain, onTrain, engine, line, net, showTrains, inset, start }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<SVGGElement>(null);
  const trains = useRef<SVGGElement>(null);
  const v = useRef<View>({ k: 1, tx: 0, ty: 0 });
  const insetRef = useRef(inset);
  insetRef.current = inset;
  // Zoom, rounded, so names are re-placed only when the zoom really changes.
  const [kq, setKq] = useState(1);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onTrainRef = useRef(onTrain);
  onTrainRef.current = onTrain;
  const anim = useRef(0);

  const apply = useCallback(() => {
    const { k, tx, ty } = v.current;
    view.current?.setAttribute("transform", `translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${k.toFixed(4)})`);
    const q = Math.round(Math.log2(k) * 8) / 8;
    setKq((x) => (x === q ? x : q));
  }, []);

  const fitK = useCallback(() => {
    const el = box.current;
    if (!el) return 1;
    const i = insetRef.current;
    const w = Math.max(80, el.clientWidth - i.left - i.right);
    const h = Math.max(80, el.clientHeight - i.top - i.bottom);
    return Math.min(w / lay.bounds.w, h / lay.bounds.h);
  }, [lay]);

  const limits = useCallback(() => {
    const f = fitK();
    // No further out than the whole network.
    return [f, Math.max(f * 9, 9)] as const;
  }, [fitK]);

  /** Moves the view so map point `at` shows at the centre of the free area, at zoom k. */
  const target = useCallback((at: Pt, k: number): View => {
    const el = box.current!;
    const i = insetRef.current;
    const cx = i.left + (el.clientWidth - i.left - i.right) / 2;
    const cy = i.top + (el.clientHeight - i.top - i.bottom) / 2;
    return { k, tx: cx - at[0] * k, ty: cy - at[1] * k };
  }, []);

  const animateTo = useCallback((to: View) => {
    cancelAnimationFrame(anim.current);
    const from = { ...v.current };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      v.current = to;
      return apply();
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 380);
      const e = 1 - (1 - t) ** 3;
      v.current = { k: from.k + (to.k - from.k) * e, tx: from.tx + (to.tx - from.tx) * e, ty: from.ty + (to.ty - from.ty) * e };
      apply();
      if (t < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  }, [apply]);

  const zoomAt = useCallback((factor: number, sx: number, sy: number) => {
    const [lo, hi] = limits();
    const { k, tx, ty } = v.current;
    const nk = Math.max(lo, Math.min(hi, k * factor));
    const f = nk / k;
    v.current = { k: nk, tx: sx - (sx - tx) * f, ty: sy - (sy - ty) * f };
    apply();
  }, [apply, limits]);

  /**
   * Until the rider pans, zooms or picks something, the map keeps the whole network fitted to
   * the free area: phones settle their toolbars, the sheet reports its height a moment after the
   * first layout, and the window can change size (user feedback, 13 Nov 2026: on phones part of
   * the map was hidden when the page opened).
   */
  const auto = useRef(!start);
  const fitNow = useCallback(() => {
    const b = lay.bounds;
    v.current = target([b.x + b.w / 2, b.y + b.h / 2], fitK());
    apply();
  }, [apply, fitK, lay, target]);

  const fit = useCallback(() => {
    const k = fitK();
    const b = lay.bounds;
    auto.current = true;
    animateTo(target([b.x + b.w / 2, b.y + b.h / 2], k));
  }, [animateTo, fitK, lay, target]);

  useImperativeHandle(ref, () => ({
    fit,
    zoom: (factor) => {
      const el = box.current;
      if (!el) return;
      auto.current = false;
      const i = insetRef.current;
      const [lo, hi] = limits();
      const k = Math.max(lo, Math.min(hi, v.current.k * factor));
      const cx = i.left + (el.clientWidth - i.left - i.right) / 2;
      const cy = i.top + (el.clientHeight - i.top - i.bottom) / 2;
      const at: Pt = [(cx - v.current.tx) / v.current.k, (cy - v.current.ty) / v.current.k];
      animateTo(target(at, k));
    },
    focus: (at, minK = 2.2) => {
      auto.current = false;
      animateTo(target(at, Math.max(v.current.k, minK)));
    },
  }), [animateTo, fit, limits, target]);

  // First view, and keep the map in its frame when the window changes size.
  const started = useRef(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (!started.current) {
        started.current = true;
        if (start) {
          v.current = target(start.at, start.k);
          apply();
          return;
        }
      }
      if (auto.current) fitNow();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [apply, fitNow, start, target]);

  // The free area changed (the sheet moved, a card opened): refit while still on the whole map.
  useEffect(() => {
    if (started.current && auto.current) fitNow();
  }, [inset.top, inset.left, inset.right, inset.bottom, fitNow]);

  // Drag, pinch and wheel.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const pts = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let downAt: { x: number; y: number } | null = null;
    let pinch: { d: number; mx: number; my: number } | null = null;
    const local = (e: PointerEvent | WheelEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      auto.current = false;
      cancelAnimationFrame(anim.current);
      el.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, local(e));
      if (pts.size === 1) {
        moved = 0;
        downAt = local(e);
      }
      pinch = null;
    };
    const move = (e: PointerEvent) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const p = local(e);
      pts.set(e.pointerId, p);
      if (pts.size === 1) {
        v.current.tx += p.x - prev.x;
        v.current.ty += p.y - prev.y;
        if (downAt) moved = Math.max(moved, Math.hypot(p.x - downAt.x, p.y - downAt.y));
        apply();
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        if (pinch) {
          v.current.tx += mx - pinch.mx;
          v.current.ty += my - pinch.my;
          zoomAt(d / (pinch.d || d), mx, my);
        }
        pinch = { d, mx, my };
        moved = 99;
      }
    };
    const up = (e: PointerEvent) => {
      const had = pts.delete(e.pointerId);
      pinch = null;
      if (!had || pts.size > 0 || moved > 6) return;
      const hit = (e.target as Element | null)?.closest?.("[data-key],[data-trip]");
      const trip = hit?.getAttribute("data-trip");
      if (trip) onTrainRef.current(trip);
      else onSelectRef.current(hit?.getAttribute("data-key") ?? null);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      auto.current = false;
      const p = local(e);
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0018)), p.x, p.y);
    };
    const dbl = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const [, hi] = limits();
      const k = Math.min(hi, v.current.k * 2);
      const at: Pt = [(e.clientX - r.left - v.current.tx) / v.current.k, (e.clientY - r.top - v.current.ty) / v.current.k];
      animateTo(target(at, k));
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("dblclick", dbl);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("dblclick", dbl);
    };
  }, [animateTo, apply, limits, target, zoomAt]);

  // Live trains (NETM-03, TRAINS-03): Kelana Jaya trains in their predicted crowding colour,
  // every other line's trains in the line's own colour (they have no crowding model).
  const kj = lay.line.KJ;
  const track = useMemo(() => (line ? trackToMap(kj, line) : null), [kj, line]);
  /** For each timetabled line, the map distance of each of its stops. */
  const others = useMemo(() => {
    if (!net) return [];
    return net.lines.flatMap((sl) => {
      const laid = lay.line[sl.id];
      if (!laid || !sl.patterns.length) return [];
      const s = sl.stops.map((st) => stationFor(lay, sl.id, st)?.s ?? null);
      return s.every((x) => x !== null) ? [{ sl, laid, s: s as number[] }] : [];
    });
  }, [lay, net]);
  const selTrain = useRef(selectedTrain);
  selTrain.current = selectedTrain;
  const netCrowd = useNetCrowd();
  const netCrowdRef = useRef(netCrowd);
  netCrowdRef.current = netCrowd;
  useEffect(() => {
    const g = trains.current;
    if (!g || !showTrains || !engine || !track) return;
    const ns = "http://www.w3.org/2000/svg";
    const nodes = new Map<string, SVGGElement>();
    const node = (id: string, r: number) => {
      let el = nodes.get(id);
      if (!el) {
        el = document.createElementNS(ns, "g");
        el.setAttribute("data-trip", id);
        el.style.cursor = "pointer";
        const halo = document.createElementNS(ns, "circle");
        halo.setAttribute("r", String(r + 1.9));
        halo.setAttribute("fill", "none");
        halo.setAttribute("stroke", "var(--accent)");
        halo.setAttribute("stroke-width", "1.1");
        const dot = document.createElementNS(ns, "circle");
        dot.setAttribute("r", String(r));
        dot.setAttribute("stroke", "#fff");
        dot.setAttribute("stroke-width", "0.8");
        const hit = document.createElementNS(ns, "circle");
        hit.setAttribute("r", "5");
        hit.setAttribute("fill", "transparent");
        el.append(halo, dot, hit);
        g.appendChild(el);
        nodes.set(id, el);
      }
      return el;
    };
    // Trains keep left, so each direction runs on its own side of the line.
    const put = (el: SVGGElement, laid: LaidLine, s: number, sign: number, fill: string, r: number) => {
      const ahead = pointAt(laid, s + sign * 0.5);
      const here = pointAt(laid, s);
      const hx = ahead.p[0] - here.p[0];
      const hy = ahead.p[1] - here.p[1];
      const l = Math.hypot(hx, hy) || 1;
      const x = here.p[0] + (hy / l) * 1.7;
      const y = here.p[1] - (hx / l) * 1.7;
      // Never smaller than about 4 px across on screen, so trains stay visible zoomed out.
      const grow = Math.max(1, 4 / (2 * r * v.current.k));
      el.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${grow.toFixed(2)})`);
      const [halo, dot] = el.children as unknown as SVGCircleElement[];
      dot.setAttribute("fill", fill);
      halo.style.display = selTrain.current === el.getAttribute("data-trip") ? "" : "none";
    };
    const unsub = subscribe((f) => {
      const seen = new Set<string>();
      for (const tr of f.trains) {
        const id = tr.run.trip.id;
        seen.add(id);
        const s = track.at(tr.state.distanceM);
        put(node(id, 2.3), kj, s, track.sign(tr.run.trip.directionId), crowdVar(crowdOf(tr.loadPct).level), 2.3);
      }
      for (const o of others) {
        for (const tr of trainsAt(o.sl, f.t)) {
          seen.add(tr.id);
          const a = o.s[tr.at];
          const b = tr.next === null ? a : o.s[tr.next];
          const sign = b === a ? (o.s[o.s.length - 1] >= o.s[0] ? tr.sign : -tr.sign) : b > a ? 1 : -1;
          // NETC-02: by crowding where the line has a model, like Kelana Jaya; else the line colour.
          const load = netTrainLoad(netCrowdRef.current, tr, f.t);
          put(node(tr.id, 1.9), o.laid, a + (b - a) * tr.f, sign, load === null ? `var(${o.laid.def.color})` : crowdVar(crowdOf(load).level), 1.9);
        }
      }
      for (const [id, el] of nodes) {
        if (!seen.has(id)) {
          el.remove();
          nodes.delete(id);
        }
      }
    });
    return () => {
      unsub();
      for (const el of nodes.values()) el.remove();
    };
  }, [engine, kj, showTrains, track, others]);

  // Stretches of the Kelana Jaya Line trains cannot pass now (ROUTE-03 on the network map).
  const now = useSimNow(5000);
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  const closed = useMemo(() => {
    if (!engine) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const b of blocksAt(engine, disruptions, now / 1000)) {
      const a = lay.station[engine.stopId(b.dir, b.lo)];
      const z = lay.station[engine.stopId(b.dir, b.hi)];
      if (!a || !z) continue;
      const key = [a.id, z.id].sort().join();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a.id === z.id ? "" : pathOf(slice(kj, a.s, z.s)));
    }
    return out.filter(Boolean);
  }, [engine, disruptions, now, lay, kj]);

  const focusSet = useMemo(() => {
    if (!focusLine) return null;
    return new Set(lay.places.filter((p) => p.stations.some((s) => s.line.id === focusLine)).map((p) => p.key));
  }, [focusLine, lay]);

  const obstacles = useMemo(() => obstaclesOf(lay), [lay]);
  const labels = useMemo(() => labelsAt(lay.places, 2 ** kq, lay.bounds, obstacles), [lay, kq, obstacles]);
  const sel = selected ? lay.places.find((p) => p.key === selected) : null;

  return (
    <div ref={box} className="absolute inset-0 touch-none select-none overflow-hidden bg-[var(--net-paper)]" style={{ cursor: "grab" }}>
      <svg className="h-full w-full" role="img" aria-label="Klang Valley integrated rail map. Use the station search or the line list to explore it.">
        <g ref={view}>
          <g aria-hidden>
            {lay.links.map(({ a, b }) => (
              <line key={`${a.id}-${b.id}`} x1={a.at[0]} y1={a.at[1]} x2={b.at[0]} y2={b.at[1]} style={{ stroke: "var(--net-link)" }} strokeWidth={1.5}
                strokeLinecap="round" opacity={focusSet && !focusSet.has(lay.placeOf[a.id].key) && !focusSet.has(lay.placeOf[b.id].key) ? 0.2 : 1} />
            ))}
            {lay.lines.map((l) => {
              const dim = focusLine && focusLine !== l.def.id;
              return (
                <g key={l.def.id} opacity={dim ? 0.13 : 1}>
                  <path d={l.d} fill="none" style={{ stroke: "var(--net-paper)" }} strokeWidth={LINE_W + 1.4} strokeLinejoin="round" />
                  <path d={l.d} fill="none" style={{ stroke: `var(${l.def.color})` }} strokeWidth={LINE_W} strokeLinecap="round" strokeLinejoin="round" />
                </g>
              );
            })}
            {closed.map((d, i) => (
              <path key={i} d={d} fill="none" style={{ stroke: "var(--net-closed)" }} strokeWidth={1.1} strokeDasharray="1.6 1.6" strokeLinecap="round" />
            ))}
          </g>

          {lay.places.map((p) => {
            const dim = focusSet && !focusSet.has(p.key);
            const one = p.stations.length === 1 ? p.stations[0] : null;
            return (
              <g key={p.key} data-key={p.key} opacity={dim ? 0.18 : 1} style={{ cursor: "pointer" }}>
                {p.hub ? (
                  <>
                    <rect x={p.box.x} y={p.box.y} width={p.box.w} height={p.box.h} rx={p.box.w / 2} style={{ fill: "var(--net-hub)" }} />
                    {p.stations.map((s, i) => (
                      <circle key={s.id} cx={p.box.x + p.box.w / 2} cy={p.box.y + 5.5 + (i * (p.box.h - 11)) / Math.max(1, p.stations.length - 1)} r={2}
                        style={{ fill: `var(${s.line.color})` }} stroke="#fff" strokeWidth={0.5} />
                    ))}
                  </>
                ) : one ? (
                  <circle cx={one.at[0]} cy={one.at[1]} r={p.label?.bold ? 1.45 : 1.15} style={{ fill: "var(--net-dot)", stroke: p.label?.bold ? "var(--net-ink)" : "none" }} strokeWidth={0.6} />
                ) : (
                  <rect x={p.box.x} y={p.box.y} width={p.box.w} height={p.box.h} rx={Math.min(p.box.w, p.box.h) / 2}
                    style={{ fill: "var(--net-dot)", stroke: "var(--net-ink)" }} strokeWidth={0.85} />
                )}
                <rect x={p.box.x - 3} y={p.box.y - 3} width={p.box.w + 6} height={p.box.h + 6} fill="transparent" />
                {labels.has(p.key) && (() => {
                  const l = labels.get(p.key)!;
                  return (
                    <text x={l.x} y={l.y} textAnchor={l.anchor} fontSize={l.size} fontWeight={l.bold ? 700 : 500}
                      style={{ fill: "var(--ink)", paintOrder: "stroke", stroke: "var(--net-paper)" }} strokeWidth={l.size * 0.21} strokeLinejoin="round">
                      {l.lines.map((t, i) => <tspan key={i} x={l.x} dy={i ? l.size * 1.18 : 0}>{t}</tspan>)}
                    </text>
                  );
                })()}
              </g>
            );
          })}

          <g aria-hidden>
            {lay.lines.flatMap((l) => l.def.badges.map((b, i) => (
              <g key={`${l.def.id}-${i}`} opacity={focusLine && focusLine !== l.def.id ? 0.18 : 1}>
                <circle cx={b[0]} cy={b[1]} r={4.6} style={{ fill: `var(${l.def.color})` }} stroke="#fff" strokeWidth={0.6} />
                <text x={b[0]} y={b[1] + 1.75} textAnchor="middle" fontSize={l.def.badge.length > 1 ? 4.1 : 5} fontWeight={800}
                  style={{ fill: l.def.inkBadge ? "var(--ink)" : "#fff" }}>{l.def.badge}</text>
              </g>
            )))}
          </g>

          <g ref={trains} />

          {sel && (
            <rect aria-hidden x={sel.box.x - 2.2} y={sel.box.y - 2.2} width={sel.box.w + 4.4} height={sel.box.h + 4.4}
              rx={Math.min(sel.box.w, sel.box.h) / 2 + 2.2} fill="none" style={{ stroke: "var(--accent)" }} strokeWidth={1.3} pointerEvents="none" />
          )}
        </g>
      </svg>
    </div>
  );
});
