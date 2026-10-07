import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LineModel } from "../sim/trains.ts";
import { CrowdEngine, type CrowdModelData } from "./model.ts";
import { crowdOf } from "./levels.ts";

const root = new URL("../../../", import.meta.url);
const line = new LineModel({ ...JSON.parse(readFileSync(new URL("data/lines/KJ.json", root), "utf8")), twin_stations: [] });
const data: CrowdModelData = JSON.parse(readFileSync(new URL("data/models/KJ.json", root), "utf8"));
const engine = new CrowdEngine(line, data);
const kl = (h: number, m = 0, day = 6) => Date.UTC(2026, 9, day, h - 8, m) / 1000; // 6 Oct 2026 is a Tuesday

test("crowding thresholds", () => {
  assert.equal(crowdOf(0).name, "Quiet");
  assert.equal(crowdOf(49.9).name, "Comfortable");
  assert.equal(crowdOf(75).name, "Crowded");
  assert.equal(crowdOf(130).name, "Packed");
});

test("headway follows the window in force, not an earlier one still on the line", () => {
  assert.equal(engine.headway(0, kl(7, 30)), 240);
  assert.equal(engine.headway(0, kl(10)), 420);
  assert.equal(engine.headway(0, kl(3)), null);
});

test("morning trains towards the city are fuller than midday ones", () => {
  const peak = engine.departures("KJ17", 0, kl(8, 0), [], 1, 3);
  const midday = engine.departures("KJ17", 0, kl(13, 0), [], 1, 3);
  const avg = (xs: { loadPct: number }[]) => xs.reduce((a, b) => a + b.loadPct, 0) / xs.length;
  assert.ok(avg(peak) > 2 * avg(midday), `${avg(peak)} vs ${avg(midday)}`);
  assert.ok(avg(peak) > 60 && avg(peak) < 160);
});

test("a held train leaves the next one more crowded", () => {
  const t = kl(18, 20);
  const normal = engine.departures("KJ21", 1, t, [], 1, 4);
  const hold = { id: "h", kind: "hold" as const, stop_id: "KJ19", to_stop_id: null, direction_id: 1, delay_s: 0,
    start_ms: (t - 300) * 1000, end_ms: (t + 600) * 1000, note: "", multiplier: 1 };
  const held = engine.departures("KJ21", 1, t, [hold], 1, 4);
  const max = (xs: { loadPct: number }[]) => Math.max(...xs.map((x) => x.loadPct));
  // The first train released after the hold carries everyone who waited behind it.
  assert.ok(max(held) > max(normal) * 1.3, `${max(held)} vs ${max(normal)}`);
});

test("an event surge raises loads downstream of the station only", () => {
  const t = kl(22, 30);
  const surge = { id: "s", kind: "surge" as const, stop_id: "KJ10", to_stop_id: null, direction_id: null, delay_s: 0,
    start_ms: (t - 600) * 1000, end_ms: (t + 3600) * 1000, note: "", multiplier: 3 };
  const base = engine.trip("KJ9", "KJ15", t, [], 1)!.options[0];
  const busy = engine.trip("KJ9", "KJ15", t, [surge], 1)!.options[0];
  assert.equal(busy.legLoads[0].toFixed(3), base.legLoads[0].toFixed(3)); // KJ9 to KJ10, before the surge
  assert.ok(busy.legLoads[1] > base.legLoads[1] * 1.3);
});

test("trip options are ordered and cover the ride", () => {
  const r = engine.trip("KJ20", "KJ15", kl(17, 50), [], 1)!;
  assert.equal(r.dir, 0);
  assert.ok(r.options.length >= 10);
  for (const o of r.options) {
    assert.equal(o.legLoads.length, 5);
    assert.ok(o.minutes >= 8 && o.minutes <= 15);
  }
});

test("typical day has no service at night and peaks in the morning towards the city", () => {
  const day = engine.typicalDay(0, 15, 1);
  assert.equal(day[3], null);
  const best = day.indexOf(Math.max(...day.map((x) => x ?? 0)));
  assert.ok(best >= 7 && best <= 9, String(best));
});
