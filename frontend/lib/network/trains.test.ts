import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { layout, stationFor } from "./layout.ts";
import { type SimNetwork, allTrainsAt, findTrain, servicesOn, trainsAt } from "./trains.ts";

const net = JSON.parse(readFileSync(new URL("../../../data/network/trains.json", import.meta.url), "utf8")) as SimNetwork;
const line = (id: string) => net.lines.find((l) => l.id === id)!;
// 13 Oct 2026 is a Tuesday; KL is UTC+8.
const kl = (h: number, m = 0, day = 13) => Date.UTC(2026, 9, day, h - 8, m) / 1000;

test("every line on the poster but Kelana Jaya has a timetable, Skypark has none", () => {
  assert.deepEqual(net.lines.map((l) => l.id).sort(), ["AG", "BRT", "E6", "E7", "K1", "K2", "KG", "MR", "PY", "SA", "SK", "SP"]);
  assert.equal(line("SK").patterns.length, 0);
  assert.equal(line("E6").source, "estimate");
});

test("every stop of every line has its station on the network map", () => {
  const lay = layout();
  for (const l of net.lines) for (const s of l.stops) assert.ok(stationFor(lay, l.id, s), `${l.id} ${s.name}`);
});

test("trains run through the day and stop at night", () => {
  const morning = allTrainsAt(net, kl(8, 15));
  const by = (id: string) => morning.filter((t) => t.line.id === id).length;
  for (const id of ["AG", "SP", "KG", "PY", "MR", "SA", "BRT", "K1", "K2", "E6", "E7"]) assert.ok(by(id) > 0, `${id} running at 08:15`);
  assert.ok(by("KG") >= 10, "a long MRT line has many trains out at the peak");
  assert.equal(allTrainsAt(net, kl(3, 30)).length, 0, "nothing at 03:30");
});

test("a train sits between the stops it runs between, and can be found again by id", () => {
  for (const tr of allTrainsAt(net, kl(17, 40))) {
    const a = tr.line.stops[tr.at].d;
    const b = tr.next === null ? a : tr.line.stops[tr.next].d;
    assert.ok(tr.d >= Math.min(a, b) - 1e-6 && tr.d <= Math.max(a, b) + 1e-6, tr.id);
    if (tr.next !== null && a !== b) assert.ok(tr.sign === (b > a ? 1 : -1), `${tr.id} heads for its next stop`);
  }
  const one = trainsAt(line("PY"), kl(12))[0];
  assert.equal(findTrain(net, one.id, kl(12))?.d, one.d);
});

test("KTM swaps weekday and weekend trains on public holidays", () => {
  const k1 = line("K1");
  const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, -8) / 1000;
  assert.ok(servicesOn(k1, day(2026, 10, 13)).includes("komuter_weekday"));
  assert.ok(servicesOn(k1, day(2026, 10, 17)).includes("komuter_weekend"), "Saturday");
  if (k1.dates["20260916"]) assert.deepEqual(servicesOn(k1, day(2026, 9, 16)).sort(), ["komuter_weekend"]);
});
