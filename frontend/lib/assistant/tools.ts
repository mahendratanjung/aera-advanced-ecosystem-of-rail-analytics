/**
 * Tools for Ask AERA (ASK-02). The model on the server only chooses which tool to call; every
 * figure comes from these functions, which run the same crowding engine and route advisor as
 * the rest of the app. Each returns compact JSON for the model and, where useful, a card the
 * chat shows under the answer.
 */

import { type Advice, advise, blocksAt, rideBlock } from "../advisor/advisor.ts";
import { type NetIndex, resolveStop } from "../advisor/network.ts";
import { crowdOf, pctText } from "../crowd/levels.ts";
import { type CrowdEngine, calmestOption, hourOf, typicalRide, weekdayOf } from "../crowd/model.ts";
import { type NetCrowdModel, busiestStretch, dayTypeOf, lineNow } from "../network/crowd.ts";
import { type SimNetwork, trainsAt } from "../network/trains.ts";
import type { Disruption } from "../types";

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const KL_OFFSET_S = 8 * 3600;

export type AskRole = "rider" | "operator" | "admin";

export interface ToolCtx {
  ix: NetIndex;
  engine: CrowdEngine;
  /** Simulated time, epoch seconds. */
  t: number;
  disruptions: Disruption[];
  mult: number;
  role: AskRole;
  home: string | null;
  /** Notices operators have published to riders. */
  notices?: string[];
  /** Every other line's timetable and typical crowding (NETC-04), when loaded. */
  net?: SimNetwork | null;
  netCrowd?: NetCrowdModel | null;
}

export type Card =
  | { kind: "options"; advice: Advice; now: number }
  | { kind: "station"; stationId: string; name: string }
  | { kind: "ride"; from: string; to: string; fromName: string; toName: string };

export interface ToolResult {
  result: Record<string, unknown>;
  card?: Card;
}

export function hm(t: number): string {
  const d = new Date((t + KL_OFFSET_S) * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

const level = (pct: number) => `${crowdOf(pct).name} (${pctText(pct)})`;

function names(ctx: ToolCtx): Record<string, string> {
  return Object.fromEntries(Object.values(ctx.ix.stop).map((s) => [s.id, s.name]));
}

function station(ctx: ToolCtx, q: unknown) {
  const s = typeof q === "string" ? resolveStop(ctx.ix, q) : null;
  return s;
}

function kjOnly(ctx: ToolCtx, q: unknown): { id: string; name: string } | { error: string } {
  const s = station(ctx, q);
  if (!s) return { error: `No station matches "${String(q)}".` };
  if (s.line.id !== "KJ") return { error: `${s.name} is on the ${s.line.name}, not the Kelana Jaya Line. Use other_ways for rides that reach it.` };
  return { id: s.id, name: s.name };
}

function blockLine(ctx: ToolCtx) {
  const n = names(ctx);
  return blocksAt(ctx.engine, ctx.disruptions, ctx.t).map((b) => ({
    what: b.kind === "suspend"
      ? `No trains between ${n[b.stopId]} and ${n[b.toStopId ?? b.stopId]}`
      : `Train held at ${n[b.stopId]}`,
    direction: ctx.engine.line.direction(b.dir).headsign,
    until: b.until === null ? "no end time given" : hm(b.until),
    note: b.note || undefined,
  }));
}

function busiestNow(ctx: ToolCtx, top = 1) {
  const live = ctx.engine.live(ctx.t, ctx.disruptions, ctx.mult).sort((a, b) => b.loadPct - a.loadPct);
  const n = names(ctx);
  const seen = new Set<string>();
  const out: { from: string; to: string; towards: string; crowding: string }[] = [];
  for (const tr of live) {
    const dir = tr.run.trip.directionId;
    const stops = ctx.engine.line.direction(dir).stops;
    const k = Math.min(tr.state.stopIndex, stops.length - 2);
    const key = `${dir}:${k}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from: n[stops[k].station_id], to: n[stops[k + 1].station_id], towards: ctx.engine.line.direction(dir).headsign, crowding: level(tr.loadPct) });
    if (out.length >= top) break;
  }
  return { out, live };
}

function parseLeaveAt(ctx: ToolCtx, v: unknown): number {
  if (typeof v !== "string" || !/^\d{1,2}:\d{2}$/.test(v.trim())) return ctx.t;
  const [h, m] = v.trim().split(":").map(Number);
  const dayStart = Math.floor((ctx.t + KL_OFFSET_S) / 86400) * 86400 - KL_OFFSET_S;
  const at = dayStart + h * 3600 + m * 60;
  return at < ctx.t - 600 ? at + 86400 : at;
}

export function runTool(name: string, args: Record<string, unknown>, ctx: ToolCtx): ToolResult {
  const n = names(ctx);
  switch (name) {
    case "service_status": {
      const blocks = blockLine(ctx);
      const other = [
        ...ctx.disruptions.filter((d) => d.kind === "surge" || d.kind === "delay").map((d) => d.note || `${d.kind} at ${n[d.stop_id]}`),
        ...(ctx.notices ?? []),
      ];
      const extra = ctx.disruptions.filter((d) => d.kind === "insert" && d.start_ms / 1000 >= ctx.t - 3600).length;
      const { out, live } = busiestNow(ctx);
      return { result: {
        time: hm(ctx.t), day: DAYS[weekdayOf(ctx.t)],
        service: blocks.length ? "disrupted" : other.length ? "running with notices" : "good service",
        disruptions: blocks, notices: other, extra_trains_added: extra || undefined, trains_running: live.length, busiest_now: out[0] ?? null,
        crowding_is: "predicted from recent gate data, not a live count",
      } };
    }
    case "find_station": {
      const s = station(ctx, args.query);
      if (!s) return { result: { error: `No Rapid Rail station matches "${String(args.query)}".` } };
      return { result: { id: s.id, name: s.name, line: s.line.name, on_kelana_jaya_line: s.line.id === "KJ" } };
    }
    case "next_trains": {
      const s = kjOnly(ctx, args.station);
      if ("error" in s) return { result: s };
      const dirs = ctx.engine.line.data.directions.map((d) => {
        const deps = ctx.engine.departures(s.id, d.direction_id, ctx.t, ctx.disruptions, ctx.mult, 3);
        return {
          towards: d.headsign,
          trains: deps.map((x) => {
            const cars = ctx.engine.carLoads(x.loadPct, d.direction_id);
            const best = cars.indexOf(Math.min(...cars)) + 1;
            return { arrives: hm(x.arrival), in_min: Math.max(0, Math.round((x.arrival - ctx.t) / 60)), crowding: level(x.loadPct),
              late_min: x.delayS > 90 ? Math.round(x.delayS / 60) : 0, best_car: best };
          }),
        };
      }).filter((d) => d.trains.length || d.towards);
      return { result: { station: s.name, now: hm(ctx.t), directions: dirs, note: "Car 1 is at the front." },
        card: { kind: "station", stationId: s.id, name: s.name } };
    }
    case "plan_ride": {
      const a = kjOnly(ctx, args.from);
      const b = kjOnly(ctx, args.to);
      if ("error" in a) return { result: a };
      if ("error" in b) return { result: b };
      const t = parseLeaveAt(ctx, args.leave_at);
      const trip = ctx.engine.trip(a.id, b.id, t, ctx.disruptions, ctx.mult, 3600);
      const blocked = !!rideBlock(ctx.engine, blocksAt(ctx.engine, ctx.disruptions, t), a.id, b.id);
      if (!trip || !trip.options.length) {
        return { result: { from: a.name, to: b.name, trains: [], disrupted: blocked,
          hint: blocked ? "This ride is disrupted. Call other_ways." : "No trains in the next hour; service runs about 06:00 to 23:15." } };
      }
      const best = calmestOption(trip.options)!;
      return {
        result: {
          from: a.name, to: b.name, leave_after: hm(t), disrupted: blocked,
          trains: trip.options.slice(0, 6).map((o) => ({ departs: hm(o.depart), arrives: hm(o.arrive), ride_min: o.minutes, crowding: level(o.peak) })),
          recommended: { departs: hm(best.depart), arrives: hm(best.arrive), crowding: level(best.peak), is_next_train: best === trip.options[0] },
          hint: blocked ? "This ride is disrupted. Call other_ways too." : undefined,
        },
        card: { kind: "ride", from: a.id, to: b.id, fromName: a.name, toName: b.name },
      };
    }
    case "other_ways": {
      const a = station(ctx, args.from);
      const b = station(ctx, args.to);
      if (!a || !b) return { result: { error: `Could not find ${!a ? String(args.from) : String(args.to)}.` } };
      const advice = advise(ctx.ix, ctx.engine, a.id, b.id, ctx.t, ctx.disruptions, ctx.mult, ctx.netCrowd ?? null);
      return {
        result: {
          from: a.name, to: b.name, now: hm(ctx.t),
          disruption: advice.block ? blockLine(ctx)[0] ?? null : null,
          options: advice.options.map((o) => ({
            title: o.title, kind: o.kind, arrive: hm(o.arrive), minutes_from_now: Math.round((o.arrive - ctx.t) / 60),
            crowding_on_kelana_jaya: o.peak === null ? "no prediction" : level(o.peak),
            legs: o.legs.map((l) => l.kind === "ride"
              ? `${l.line} ${l.fromName} to ${l.toName}${l.estimate ? " (estimated time)" : ` ${hm(l.depart)}-${hm(l.arrive)}`}`
              : l.kind === "walk" ? `walk about ${Math.max(1, Math.round((l.arrive - l.depart) / 60))} min${l.fromName === l.toName ? ` to change at ${l.fromName}` : ` from ${l.fromName} to ${l.toName}`}`
              : `bus or e-hailing ${l.fromName} to ${l.toName}, about ${Math.round((l.arrive - l.depart) / 60)} min`),
          })),
          caution: "Other lines, walks and roads are estimates. Crowding is predicted only for the Kelana Jaya Line.",
        },
        card: advice.options.length ? { kind: "options", advice, now: ctx.t } : undefined,
      };
    }
    case "best_time": {
      const a = kjOnly(ctx, args.from);
      const b = kjOnly(ctx, args.to);
      if ("error" in a) return { result: a };
      if ("error" in b) return { result: b };
      const dayArg = typeof args.day === "string" ? DAYS.findIndex((d) => d.toLowerCase().startsWith(String(args.day).toLowerCase().slice(0, 3))) : -1;
      const weekday = dayArg >= 0 ? dayArg : weekdayOf(ctx.t);
      const dir = ctx.engine.idx[b.id] > ctx.engine.idx[a.id] ? 1 : 0;
      const ko = ctx.engine.line.stopIndex[dir][a.id];
      const kd = ctx.engine.line.stopIndex[dir][b.id];
      const hours = typicalRide(ctx.engine, dir, ko, kd, weekday);
      const byHour: Record<string, string> = {};
      hours.forEach((v, h) => { if (v !== null && h >= 6) byHour[`${String(h).padStart(2, "0")}:00`] = crowdOf(v).name; });
      const calm = Object.entries(byHour).filter(([, v]) => v === "Quiet" || v === "Comfortable").map(([k]) => k);
      return { result: { from: a.name, to: b.name, day: DAYS[weekday], typical_crowding_by_hour: byHour, calmer_hours: calm,
        now_hour: weekday === weekdayOf(ctx.t) ? `${String(Math.floor(hourOf(ctx.t))).padStart(2, "0")}:00` : undefined },
        card: { kind: "ride", from: a.id, to: b.id, fromName: a.name, toName: b.name } };
    }
    case "line_overview": {
      const { out, live } = busiestNow(ctx, 3);
      return { result: {
        time: hm(ctx.t), trains_running: live.length,
        over_capacity: live.filter((x) => x.loadPct >= 100).length,
        crowded_or_packed: live.filter((x) => x.loadPct >= 75).length,
        held: live.filter((x) => x.state.status === "held").length,
        busiest_stretches: out, disruptions: blockLine(ctx),
        demand_scenario: ctx.mult !== 1 ? `demand x${ctx.mult}` : "typical",
      } };
    }
    case "other_lines": {
      if (!ctx.net || !ctx.netCrowd) return { result: { error: "Other lines' crowding is still loading." } };
      const m = ctx.netCrowd;
      const q = typeof args.line === "string" ? args.line.trim().toLowerCase() : "";
      const lines = ctx.net.lines.filter((l) => m.lines[l.id]);
      const pick = q ? lines.filter((l) => l.id.toLowerCase() === q || l.name.toLowerCase().includes(q) || (q.includes("monorail") && l.id === "MR")) : lines;
      if (q && !pick.length) return { result: { error: `No crowding for "${args.line}". Lines with crowding: ${lines.map((l) => l.name).join(", ")}. ERL and BRT publish no ridership.` } };
      const hour = Math.floor(hourOf(ctx.t));
      return { result: {
        time: hm(ctx.t), basis: "typical for this hour and day type, from data.gov.my gate data; not live",
        lines: pick.map((l) => {
          const trains = trainsAt(l, ctx.t);
          const now = lineNow(m, trains, ctx.t);
          const top = busiestStretch(m, l.id, dayTypeOf(ctx.t), hour);
          const stopName = (id: string) => l.stops.find((s) => s.id === id)?.name ?? id;
          return now
            ? { line: l.name, trains_running: trains.length, most_trains: level(now.mean), fullest_train: { crowding: level(now.max), between: `${now.from} and ${now.to}` },
              busiest_stretch_this_hour: top ? `${top.key.split(">").map(stopName).join(" to ")}, ${level(top.load)}` : undefined }
            : { line: l.name, trains_running: trains.length, note: "No trains running now." };
        }),
      } };
    }
    default:
      return { result: { error: `Unknown tool ${name}` } };
  }
}
