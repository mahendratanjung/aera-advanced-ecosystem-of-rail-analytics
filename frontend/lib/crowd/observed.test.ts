import { test } from "node:test";
import assert from "node:assert/strict";
import { type ObservedLoad, blendLegs, describeSources, sdAt } from "./observed.ts";

const obs = (pct: number, sd: number, extra: Partial<ObservedLoad> = {}): ObservedLoad => ({
  trip_id: "T", pct, sd, stop_index: 2, n: 1, sources: { rider_report: 1 }, updated_ms: 0, as_of_ms: 0,
  half_life_s: 240, ...extra,
});

test("one rider report nudges the prediction, a sensor nearly replaces it", () => {
  const legs = [20, 30, 40, 40, 40];
  const report = blendLegs(legs, obs(85, 23), 0);
  assert.ok(report[2] > 40 && report[2] < 60, `report moved it to ${report[2]}`);
  const sensor = blendLegs(legs, obs(85, 4), 0);
  assert.ok(sensor[2] > 80, `sensor moved it to ${sensor[2]}`);
  assert.deepEqual(report.slice(0, 2), [20, 30]); // legs already travelled are untouched
});

test("the correction fades over the next stops and over time", () => {
  const legs = [40, 40, 40, 40, 40, 40, 40, 40];
  const b = blendLegs(legs, obs(80, 4), 0);
  for (let j = 3; j < legs.length; j++) assert.ok(b[j] <= b[j - 1] && b[j] > 40);
  const later = blendLegs(legs, obs(80, 4), 30 * 60_000);
  assert.ok(later[2] < b[2] - 20, "half an hour later the reading counts for little");
  assert.ok(sdAt(obs(80, 4), 240_000 * 2) > 7.9);
});

test("a near-empty prediction still takes an observed crowd", () => {
  const b = blendLegs([0, 0, 0, 0], obs(60, 4), 0);
  assert.ok(b[2] > 50 && b[3] > 20);
});

test("sources read as plain English", () => {
  assert.equal(describeSources(obs(1, 1, { sources: { rider_report: 2, camera: 1 } })), "2 rider reports and 1 camera count");
});
