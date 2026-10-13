/**
 * Quick answers without a language model (ASK-04). Used when the server has no OpenRouter key,
 * the free model is busy, or the network fails. It spots station names and the kind of
 * question, runs the same tools as the model would, and writes a short answer from them.
 */

import { resolveStop } from "../advisor/network.ts";
import { type Card, type ToolCtx, runTool } from "./tools.ts";

const ALIASES: Record<string, string> = { sentral: "KJ15", "kl central": "KJ15", "twin towers": "KJ10", petronas: "KJ10", ktm: "KJ15" };

function norm(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** Stations named in the text, in the order they appear, Kelana Jaya stops preferred. */
export function stationsIn(ctx: ToolCtx, text: string): { id: string; at: number }[] {
  const t = norm(text);
  const names = new Map<string, string>();
  for (const s of Object.values(ctx.ix.stop)) {
    const key = norm(s.name).trim();
    if (key.length < 3) continue;
    const best = resolveStop(ctx.ix, s.name);
    if (best && !names.has(key)) names.set(key, best.id);
  }
  for (const [k, id] of Object.entries(ALIASES)) names.set(k, id);
  const hits: { id: string; at: number; len: number }[] = [];
  for (const [key, id] of names) {
    const at = t.indexOf(` ${key} `);
    if (at >= 0) hits.push({ id, at, len: key.length });
  }
  // Drop names inside longer ones ("Jaya" inside "Taman Jaya").
  const kept = hits.filter((h) => !hits.some((o) => o !== h && o.len > h.len && o.at <= h.at && o.at + o.len >= h.at + h.len));
  const seen = new Set<string>();
  return kept.sort((a, b) => a.at - b.at).filter((h) => !seen.has(h.id) && seen.add(h.id)).map(({ id, at }) => ({ id, at }));
}

export interface LocalAnswer {
  text: string;
  cards: Card[];
}

const has = (t: string, re: RegExp) => re.test(t.toLowerCase());

export function localAnswer(question: string, ctx: ToolCtx): LocalAnswer {
  const q = question.trim();
  const found = stationsIn(ctx, q);
  const lower = ` ${q.toLowerCase()} `;
  const toAt = lower.search(/\b(to|towards|reach|get to|go to)\b/);
  const fromAt = lower.search(/\bfrom\b/);
  let from: string | null = null;
  let to: string | null = null;
  if (found.length >= 2) {
    const fromHit = fromAt >= 0 ? found.find((f) => f.at > fromAt) : null;
    const toHit = toAt >= 0 ? found.find((f) => f.at > toAt && f !== fromHit) : null;
    from = (fromHit ?? found.find((f) => f !== toHit) ?? found[0]).id;
    to = (toHit ?? found.find((f) => f.id !== from)!).id;
  } else if (found.length === 1 && toAt >= 0 && found[0].at > toAt) {
    from = ctx.home;
    to = found[0].id;
  }

  if (has(q, /overview|kpi|whole line|line wide|operator/) && !to) return overview(ctx);
  const lineQ = q.toLowerCase().match(/\b(mrt|kajang|putrajaya|ampang|sri petaling|monorail|shah alam|komuter|ktm|other lines?|every line|all lines)\b/);
  if (lineQ && !to && has(q, /busy|crowd|full|packed|quiet|how is|congest/)) return otherLines(ctx, lineQ[1]);
  if (from && to && from !== to) {
    if (has(q, /quiet|calm|best time|less (crowded|busy)|when should|empty|seat/)) return bestTime(ctx, from, to);
    const kj = ctx.ix.stop[from]?.line.id === "KJ" && ctx.ix.stop[to]?.line.id === "KJ";
    const ways = runTool("other_ways", { from, to }, ctx);
    const r = ways.result as { disruption: unknown; options: { title: string; arrive: string; minutes_from_now: number; crowding_on_kelana_jaya: string }[] };
    if (!kj || r.disruption) return { text: waysText(ctx, from, to, r), cards: ways.card ? [ways.card] : [] };
    return ride(ctx, from, to);
  }
  if (found.length === 1 && !has(q, /\bto\b/)) return next(ctx, found[0].id);
  if (has(q, /status|disrupt|running|delay|fail|fault|broken|suspend|problem|line ok|service/)) return status(ctx);
  return {
    text: "I can tell you the next trains at a station, plan a ride with crowding, find other ways when trains are not running, or say when a ride is usually quieter. Try one of the suggestions, or name two stations, for example \"Taman Jaya to KLCC\".",
    cards: [],
  };
}

function otherLines(ctx: ToolCtx, word: string): LocalAnswer {
  const all = /other|every|all|mrt|ktm|komuter/.test(word);
  const r = runTool("other_lines", all ? {} : { line: word }, ctx).result as { error?: string; time: string; lines: { line: string; most_trains?: string; fullest_train?: { crowding: string; between: string } }[] };
  if (r.error) return { text: r.error, cards: [] };
  const want = word === "mrt" ? r.lines.filter((l) => l.line.startsWith("MRT")) : /ktm|komuter/.test(word) ? r.lines.filter((l) => l.line.startsWith("KTM")) : r.lines;
  const rows = want.filter((l) => l.most_trains).map((l) => `- **${l.line}**: mostly ${l.most_trains!.split(" (")[0].toLowerCase()}; fullest ${l.fullest_train!.crowding.split(" (")[0].toLowerCase()} between ${l.fullest_train!.between}`);
  if (!rows.length) return { text: `No trains are running on those lines at ${r.time}.`, cards: [] };
  return { text: `At ${r.time}, trains usually carry this much (typical week, not live):\n${rows.join("\n")}`, cards: [] };
}

function next(ctx: ToolCtx, id: string): LocalAnswer {
  const r = runTool("next_trains", { station: id }, ctx);
  const res = r.result as { error?: string; station: string; directions: { towards: string; trains: { in_min: number; crowding: string; best_car: number }[] }[] };
  if (res.error) return { text: res.error, cards: [] };
  const lines = res.directions.filter((d) => d.trains.length).map((d) => {
    const x = d.trains[0];
    return `Towards ${d.towards}: ${x.in_min === 0 ? "now" : `in ${x.in_min} min`}, ${x.crowding.split(" (")[0].toLowerCase()}, board at car ${x.best_car}.`;
  });
  return { text: lines.length ? `At ${res.station}:\n${lines.map((l) => `- ${l}`).join("\n")}` : `No more trains at ${res.station} tonight.`, cards: r.card ? [r.card] : [] };
}

function ride(ctx: ToolCtx, from: string, to: string): LocalAnswer {
  const r = runTool("plan_ride", { from, to }, ctx);
  const res = r.result as { error?: string; from: string; to: string; trains: unknown[]; recommended?: { departs: string; arrives: string; crowding: string; is_next_train: boolean }; hint?: string };
  if (res.error) return { text: res.error, cards: [] };
  if (!res.recommended) return { text: res.hint ?? `No trains from ${res.from} to ${res.to} in the next hour.`, cards: [] };
  const b = res.recommended;
  const lead = b.is_next_train ? "Take the next train" : "Wait a little: a calmer train";
  return { text: `${lead}, leaving ${res.from} at ${b.departs} and reaching ${res.to} at ${b.arrives}. It should be ${b.crowding.split(" (")[0].toLowerCase()} at its busiest.`, cards: r.card ? [r.card] : [] };
}

function waysText(ctx: ToolCtx, from: string, to: string, r: { disruption: unknown; options: { title: string; arrive: string; minutes_from_now: number; crowding_on_kelana_jaya: string }[] }): string {
  const a = ctx.ix.stop[from]?.name;
  const b = ctx.ix.stop[to]?.name;
  if (!r.options.length) return `I could not find a way from ${a} to ${b} right now.`;
  const d = r.disruption as { what: string; until: string } | null;
  const head = d ? `${d.what}${d.until.includes(":") ? ` until about ${d.until}` : ""}. ` : "";
  const list = r.options.slice(0, 3).map((o) => `- ${o.title}: arrive about ${o.arrive} (${o.minutes_from_now} min)`).join("\n");
  return `${head}From ${a} to ${b}, fastest first:\n${list}\nTimes off the Kelana Jaya Line are estimates.`;
}

function bestTime(ctx: ToolCtx, from: string, to: string): LocalAnswer {
  const r = runTool("best_time", { from, to }, ctx);
  const res = r.result as { error?: string; from: string; to: string; day: string; calmer_hours: string[]; typical_crowding_by_hour: Record<string, string> };
  if (res.error) return { text: res.error, cards: [] };
  const busy = Object.entries(res.typical_crowding_by_hour).filter(([, v]) => v === "Crowded" || v === "Packed").map(([k]) => k);
  const span = (hs: string[]) => (hs.length ? `${hs[0]} to ${hs[hs.length - 1].replace(":00", ":59")}` : "none");
  return {
    text: `On a typical ${res.day}, ${res.from} to ${res.to} is most crowded around ${busy.length ? busy.join(", ") : "no hour in particular"}. Calmer hours: ${res.calmer_hours.length ? res.calmer_hours.slice(0, 8).join(", ") : span([])}.`,
    cards: r.card ? [r.card] : [],
  };
}

function status(ctx: ToolCtx): LocalAnswer {
  const r = runTool("service_status", {}, ctx).result as { time: string; service: string; disruptions: { what: string; until: string; direction: string }[]; busiest_now: { from: string; to: string; crowding: string } | null };
  if (r.disruptions.length) {
    const d = r.disruptions[0];
    return { text: `${d.what} (towards ${d.direction}), ${d.until.includes(":") ? `until about ${d.until}` : "with no end time yet"}. Tell me where you are going and I will find other ways.`, cards: [] };
  }
  return { text: `Good service at ${r.time}.${r.busiest_now ? ` The most crowded stretch is ${r.busiest_now.from} to ${r.busiest_now.to}, ${r.busiest_now.crowding.split(" (")[0].toLowerCase()}.` : ""}`, cards: [] };
}

function overview(ctx: ToolCtx): LocalAnswer {
  const r = runTool("line_overview", {}, ctx).result as { time: string; trains_running: number; over_capacity: number; crowded_or_packed: number; held: number; busiest_stretches: { from: string; to: string; crowding: string }[] };
  const top = r.busiest_stretches.map((b) => `- ${b.from} to ${b.to}: ${b.crowding}`).join("\n");
  return { text: `At ${r.time}: ${r.trains_running} trains running, ${r.crowded_or_packed} crowded or packed, ${r.over_capacity} over capacity, ${r.held} held.\nBusiest stretches:\n${top}`, cards: [] };
}
