import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LineModel } from "../sim/trains.ts";
import { CrowdEngine, type CrowdModelData } from "../crowd/model.ts";
import { type Network, indexNetwork } from "../advisor/network.ts";
import type { Disruption } from "../types";
import { localAnswer, stationsIn } from "./local.ts";
import { type ToolCtx, runTool } from "./tools.ts";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), "utf8"));
const engine = new CrowdEngine(new LineModel({ ...read("data/lines/KJ.json"), twin_stations: [] }), read("data/models/KJ.json") as CrowdModelData);
const ix = indexNetwork(read("data/network/rapid.json") as Network);
const t = Date.UTC(2026, 9, 6, 10, 10) / 1000; // Tuesday 18:10 in Kuala Lumpur
const suspension: Disruption = { id: "s", kind: "suspend", stop_id: "KJ13", to_stop_id: "KJ10", direction_id: null, delay_s: 0,
  multiplier: 1, start_ms: (t - 300) * 1000, end_ms: (t + 1200) * 1000, note: "Section suspended (scenario)" };
const ctx = (disruptions: Disruption[] = []): ToolCtx => ({ ix, engine, t, disruptions, mult: 1, role: "rider", home: "KJ20" });

test("tools answer from the engine and stay in English crowding words", () => {
  const next = runTool("next_trains", { station: "kl sentral" }, ctx()).result as { station: string; directions: { trains: { crowding: string }[] }[] };
  assert.equal(next.station, "KL Sentral");
  const words = /^(Quiet|Comfortable|Busy|Crowded|Packed) /;
  for (const d of next.directions) for (const tr of d.trains) assert.match(tr.crowding, words);
  const ride = runTool("plan_ride", { from: "Taman Jaya", to: "KLCC" }, ctx());
  assert.ok((ride.result as { recommended?: unknown }).recommended);
  assert.equal(ride.card?.kind, "ride");
});

test("status names the disruption and other_ways returns option cards", () => {
  const st = runTool("service_status", {}, ctx([suspension])).result as { service: string; disruptions: { what: string; until: string }[] };
  assert.equal(st.service, "disrupted");
  assert.match(st.disruptions[0].what, /Masjid Jamek/);
  assert.equal(st.disruptions[0].until, "18:30");
  const ways = runTool("other_ways", { from: "KJ20", to: "KJ10" }, ctx([suspension]));
  assert.equal(ways.card?.kind, "options");
  assert.ok(((ways.result as { options: unknown[] }).options).length >= 2);
});

test("tools refuse what they cannot answer instead of guessing", () => {
  const r = runTool("next_trains", { station: "Bukit Bintang" }, ctx()).result as { error?: string };
  assert.match(r.error ?? "", /not the Kelana Jaya Line/);
  assert.ok((runTool("plan_ride", { from: "nowhere", to: "KLCC" }, ctx()).result as { error?: string }).error);
});

test("quick answers find stations and the kind of question", () => {
  assert.deepEqual(stationsIn(ctx(), "from Taman Jaya to KL Sentral").map((s) => s.id), ["KJ20", "KJ15"]);
  const ways = localAnswer("The line is down, how do I get from Taman Jaya to KLCC?", ctx([suspension]));
  assert.match(ways.text, /fastest first/);
  assert.equal(ways.cards[0]?.kind, "options");
  const home = localAnswer("how do I get to KL Sentral", ctx());
  assert.match(home.text, /Taman Jaya/);
  assert.match(localAnswer("Next train at Kelana Jaya?", ctx()).text, /Towards/);
  assert.match(localAnswer("is the line ok?", ctx([suspension])).text, /No trains between/);
  assert.match(localAnswer("hello", ctx()).text, /I can tell you/);
});

test("other_lines answers from the network model and says it is typical, not live", async () => {
  const { withMapNames, layout } = await import("../network/layout.ts");
  const net = withMapNames(layout(), read("data/network/trains.json"));
  const netCrowd = read("data/models/network.json");
  const c = { ...ctx(), net, netCrowd };
  const all = runTool("other_lines", {}, c).result as { basis: string; lines: { line: string; most_trains?: string }[] };
  assert.match(all.basis, /not live/);
  assert.ok(all.lines.length >= 8);
  const kg = runTool("other_lines", { line: "kajang" }, c).result as { lines: { line: string; most_trains: string }[] };
  assert.equal(kg.lines.length, 1);
  assert.match(kg.lines[0].most_trains, /^(Quiet|Comfortable|Busy|Crowded|Packed) /);
  const none = runTool("other_lines", { line: "klia" }, c).result as { error?: string };
  assert.match(none.error ?? "", /ERL and BRT/);
});

test("quick answers cover other lines without a model", async () => {
  const { withMapNames, layout } = await import("../network/layout.ts");
  const c = { ...ctx(), net: withMapNames(layout(), read("data/network/trains.json")), netCrowd: read("data/models/network.json") };
  const a = localAnswer("How busy is the MRT right now?", c);
  assert.match(a.text, /MRT Kajang/);
  assert.match(a.text, /not live/);
});
