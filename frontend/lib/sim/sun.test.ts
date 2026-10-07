import { test } from "node:test";
import assert from "node:assert/strict";
import { daylight, sunPosition } from "./sun.ts";

const KL = { lat: 3.14, lon: 101.69 };
// 7 Oct 2026 at a KL wall-clock time (UTC+8).
const at = (hh: number, mm = 0) => Date.UTC(2026, 9, 7, hh - 8, mm);

test("sun over Kuala Lumpur follows the day", () => {
  const noon = sunPosition(at(13, 5), KL.lat, KL.lon);
  assert.ok(noon.altitude > 75, `solar noon altitude ${noon.altitude}`);
  const night = sunPosition(at(1), KL.lat, KL.lon);
  assert.ok(night.altitude < -30, `1 am altitude ${night.altitude}`);
  const morning = sunPosition(at(7, 40), KL.lat, KL.lon);
  assert.ok(morning.altitude > 0 && morning.altitude < 15, `morning altitude ${morning.altitude}`);
  assert.ok(morning.azimuth > 80 && morning.azimuth < 110, `morning azimuth ${morning.azimuth}`);
  const evening = sunPosition(at(18, 40), KL.lat, KL.lon);
  assert.ok(evening.altitude > 0 && evening.altitude < 10, `evening altitude ${evening.altitude}`);
  assert.ok(evening.azimuth > 250 && evening.azimuth < 290, `evening azimuth ${evening.azimuth}`);
  assert.ok(sunPosition(at(19, 40), KL.lat, KL.lon).altitude < 0);
});

test("daylight phases", () => {
  assert.equal(daylight(sunPosition(at(12), KL.lat, KL.lon)).phase, "Day");
  assert.equal(daylight(sunPosition(at(12), KL.lat, KL.lon)).night, 0);
  assert.equal(daylight(sunPosition(at(23), KL.lat, KL.lon)).night, 1);
  assert.equal(daylight(sunPosition(at(23), KL.lat, KL.lon)).phase, "Night");
  assert.equal(daylight({ altitude: -2, azimuth: 270 }).phase, "Dusk");
  assert.equal(daylight({ altitude: -2, azimuth: 90 }).phase, "Dawn");
});
