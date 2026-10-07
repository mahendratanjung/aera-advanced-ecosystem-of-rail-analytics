import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LineModel } from "./trains.ts";

const root = new URL("../../../", import.meta.url);
const line = JSON.parse(readFileSync(new URL("data/lines/KJ.json", root), "utf8"));
const fixtures = JSON.parse(readFileSync(new URL("./__fixtures__/positions.json", import.meta.url), "utf8"));
const model = new LineModel({ ...line, twin_stations: [] });

test("train positions match the Python twin service (SIM-02)", () => {
  for (const c of fixtures.cases) {
    const got = model.activeTrains(c.t, c.disruptions).map((s) => [s.tripId, s.status, Math.round(s.distanceM * 1000) / 1000, s.loadPct]);
    assert.equal(got.length, c.trains.length, `train count at ${c.t}`);
    got.forEach((row, i) => {
      const want = c.trains[i];
      assert.equal(row[0], want[0]);
      assert.equal(row[1], want[1]);
      assert.ok(Math.abs((row[2] as number) - want[2]) < 0.01, `distance ${row[2]} vs ${want[2]}`);
      assert.ok(Math.abs((row[3] as number) - want[3]) <= 0.1, `load ${row[3]} vs ${want[3]}`);
    });
  }
});

test("next departures match the Python twin service", () => {
  const n = fixtures.next;
  const disruptions = fixtures.cases[fixtures.cases.length - 1].disruptions;
  const got = model.nextDepartures(n.station, n.t, disruptions);
  for (const [dir, rows] of Object.entries(n.rows as Record<string, [string, number, number][]>)) {
    assert.deepEqual(got[Number(dir)].map((r) => [r.tripId, r.arrival, r.delayS]), rows);
  }
});
