import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LineModel } from "../sim/trains.ts";
import { CrowdEngine, type CrowdModelData } from "../crowd/model.ts";
import type { Disruption } from "../types";
import { advise, blocksAt, rideBlock } from "./advisor.ts";
import { type Network, indexNetwork, netHeadway, resolveStop } from "./network.ts";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), "utf8"));
const line = new LineModel({ ...read("data/lines/KJ.json"), twin_stations: [] });
const engine = new CrowdEngine(line, read("data/models/KJ.json") as CrowdModelData);
const ix = indexNetwork(read("data/network/rapid.json") as Network);
const kl = (h: number, m = 0, day = 6) => Date.UTC(2026, 9, day, h - 8, m) / 1000; // 6 Oct 2026 is a Tuesday

const t = kl(18, 10);
const suspension: Disruption = { id: "s", kind: "suspend", stop_id: "KJ13", to_stop_id: "KJ10", direction_id: null, delay_s: 0,
  multiplier: 1, start_ms: (t - 300) * 1000, end_ms: (t + 20 * 60) * 1000, note: "Section suspended" };

test("a suspended section blocks rides through it in both directions, not rides beside it", () => {
  const blocks = blocksAt(engine, [suspension], t);
  assert.equal(blocks.length, 2);
  assert.ok(rideBlock(engine, blocks, "KJ20", "KJ10"));
  assert.ok(rideBlock(engine, blocks, "KJ5", "KJ15"));
  assert.equal(rideBlock(engine, blocks, "KJ20", "KJ14"), null);
  assert.equal(rideBlock(engine, blocks, "KJ1", "KJ9"), null);
  assert.equal(blocksAt(engine, [suspension], t + 30 * 60).length, 0, "over once it ends");
});

test("no disruption: one direct Kelana Jaya ride with crowding", () => {
  const a = advise(ix, engine, "KJ20", "KJ10", t, []);
  assert.equal(a.block, null);
  assert.equal(a.options.length, 1);
  assert.equal(a.options[0].kind, "direct");
  assert.equal(typeof a.options[0].peak, "number");
});

test("suspension: wait, go round on other lines, or bridge by road", () => {
  const a = advise(ix, engine, "KJ20", "KJ10", t, [suspension]);
  assert.ok(a.block);
  const kinds = new Set(a.options.map((o) => o.kind));
  assert.ok(kinds.has("wait") && kinds.has("reroute") && kinds.has("road"), [...kinds].join());
  const round = a.options.find((o) => o.kind === "reroute")!;
  assert.ok(round.legs.some((l) => l.kind === "ride" && l.line !== "KJ"), "uses another line");
  assert.ok(round.legs.every((l) => l.kind !== "ride" || l.line !== "KJ" || typeof l.crowd === "number" || l.estimate));
  for (const o of a.options) {
    assert.ok(o.arrive > t && Number.isFinite(o.arrive), `${o.kind} arrives`);
    for (let i = 1; i < o.legs.length; i++) assert.ok(o.legs[i].depart >= o.legs[i - 1].arrive - 1, `${o.kind} legs in order`);
  }
  const wait = a.options.find((o) => o.kind === "wait")!;
  assert.ok(wait.depart >= t);
  assert.deepEqual(a.options.map((o) => o.arrive), [...a.options.map((o) => o.arrive)].sort((x, y) => x - y));
});

test("a held train blocks only its own direction", () => {
  const hold: Disruption = { ...suspension, id: "h", kind: "hold", stop_id: "KJ19", to_stop_id: null, direction_id: 1 };
  const blocks = blocksAt(engine, [hold], t);
  assert.equal(blocks.length, 1);
  assert.ok(rideBlock(engine, blocks, "KJ17", "KJ21"));
  assert.equal(rideBlock(engine, blocks, "KJ21", "KJ17"), null);
});

test("stations resolve from codes and names", () => {
  assert.equal(resolveStop(ix, "KJ15")?.id, "KJ15");
  assert.equal(resolveStop(ix, "kl sentral")?.id, "KJ15");
  assert.equal(resolveStop(ix, "Masjid Jamek")?.id, "KJ13");
  assert.equal(resolveStop(ix, "zzz"), null);
});

test("other lines have headways in service and none at night", () => {
  const mrt = ix.line["KG"];
  assert.ok((netHeadway(mrt, 0, kl(8)) ?? 0) > 0);
  assert.equal(netHeadway(mrt, 0, kl(3)), null);
});

test("rides onto other lines carry their typical crowding when the network model is given", () => {
  const netCrowd = read("data/models/network.json");
  const plain = advise(ix, engine, "KJ20", "KG20", t, []);
  const withCrowd = advise(ix, engine, "KJ20", "KG20", t, [], 1, netCrowd);
  const other = (a: typeof plain) => a.options.flatMap((o) => o.legs).filter((l) => l.kind === "ride" && l.line !== "KJ");
  assert.ok(other(plain).length > 0, "the ride uses another line");
  assert.ok(other(plain).every((l) => l.crowd === null));
  assert.ok(other(withCrowd).every((l) => typeof l.crowd === "number"));
  assert.ok(withCrowd.options.every((o) => o.peak !== null));
});
