import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { type NetCrowdModel, busiestStretch, dayTypeOf, lineNow, netTrainLoad, stretchLoad } from "./crowd.ts";
import { type SimNetwork, trainsAt } from "./trains.ts";

const net = JSON.parse(readFileSync(new URL("../../../data/network/trains.json", import.meta.url), "utf8")) as SimNetwork;
const model = JSON.parse(readFileSync(new URL("../../../data/models/network.json", import.meta.url), "utf8")) as NetCrowdModel;
// 13 Oct 2026 is a Tuesday; KL is UTC+8.
const kl = (h: number, m = 0, day = 13) => Date.UTC(2026, 9, day, h - 8, m) / 1000;

test("day types follow the KL calendar", () => {
  assert.equal(dayTypeOf(kl(8)), 0);
  assert.equal(dayTypeOf(kl(8, 0, 17)), 1);
  assert.equal(dayTypeOf(kl(8, 0, 18)), 2);
  assert.equal(dayTypeOf(kl(23, 30, 16)), 0); // still Friday in KL
});

test("every rail line with public ridership has crowding; ERL, BRT and Skypark do not", () => {
  assert.deepEqual(Object.keys(model.lines).sort(), ["AG", "K1", "K2", "KG", "MR", "PY", "SA", "SP"]);
});

test("most trains running at the morning peak have a load", () => {
  for (const id of ["AG", "SP", "KG", "PY", "MR", "SA"]) {
    const line = net.lines.find((l) => l.id === id)!;
    const trains = trainsAt(line, kl(8, 15)).filter((x) => x.next !== null);
    const known = trains.filter((x) => netTrainLoad(model, x, kl(8, 15)) !== null);
    assert.ok(trains.length > 0, id);
    assert.ok(known.length / trains.length > 0.9, `${id}: ${known.length}/${trains.length}`);
  }
});

test("inbound trains are fuller in the morning than late at night", () => {
  const am = stretchLoad(model, "KG", "KG21", "KG20", kl(8, 30))!;
  const late = stretchLoad(model, "KG", "KG21", "KG20", kl(22, 30))!;
  assert.ok(am > late, `${am} vs ${late}`);
  assert.equal(stretchLoad(model, "KG", "KG21", "KG20", kl(3)), null);
});

test("a line's state now names its fullest train", () => {
  const line = net.lines.find((l) => l.id === "KG")!;
  const now = lineNow(model, trainsAt(line, kl(8, 15)), kl(8, 15))!;
  assert.ok(now.max >= now.mean && now.mean > 0);
  assert.ok(busiestStretch(model, "KG", 0, 8)!.load > 0);
});
