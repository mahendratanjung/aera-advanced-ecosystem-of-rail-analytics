import { test } from "node:test";
import assert from "node:assert/strict";
import { NEAR_KM, distanceKm, distanceText, nearestStation } from "./nearby.ts";
import { activeHref, navFor } from "../components/nav.ts";
import { stepText } from "./assistant/steps.ts";

const STATIONS = [
  { id: "KJ15", name: "KL Sentral", lat: 3.1343, lon: 101.6862 },
  { id: "KJ14", name: "Pasar Seni", lat: 3.1424, lon: 101.6953 },
  { id: "KJ20", name: "Taman Jaya", lat: 3.1043, lon: 101.6454 },
];

test("LIVE-01: the nearest station and how far it is", () => {
  const n = nearestStation(STATIONS, { lat: 3.1410, lon: 101.6940 })!;
  assert.equal(n.station.id, "KJ14");
  assert.ok(n.km < 0.3);
  assert.equal(nearestStation([], { lat: 0, lon: 0 }), null);
  // KL Sentral to Pasar Seni is about 1.3 km.
  assert.ok(Math.abs(distanceKm(3.1343, 101.6862, 3.1424, 101.6953) - 1.35) < 0.1);
  // Far from the line (Penang) is well past "near".
  assert.ok(nearestStation(STATIONS, { lat: 5.41, lon: 100.33 })!.km > NEAR_KM);
});

test("distances read like a map app", () => {
  assert.equal(distanceText(0.01), "50 m");
  assert.equal(distanceText(0.34), "350 m");
  assert.equal(distanceText(2.345), "2.3 km");
  assert.equal(distanceText(27.6), "28 km");
});

test("OPS-01, VIEW-02: riders get four tabs (Busy times removed); staff get Operations, the map and Ask; admins also Admin", () => {
  assert.deepEqual(navFor("rider", true).map((n) => n.label), ["Live", "Network", "Plan", "Ask"]);
  assert.deepEqual(navFor("rider").map((n) => n.href), ["/", "/network", "/trip", "/ask"]);
  assert.ok(!navFor("rider").some((n) => n.href === "/status" || n.href === "/insights"), "Status and Busy times are gone");
  assert.deepEqual(navFor("operator").map((n) => n.label), ["Operations", "Live map", "Ask"]);
  assert.deepEqual(navFor("operator", false, true).map((n) => n.label), ["Operations", "Live map", "Ask", "Admin"]);
  assert.ok(navFor("operator", true, true).length <= 5);
  assert.equal(activeHref("/control", navFor("operator")), "/control");
  assert.equal(activeHref("/station/KJ15", navFor("rider")), "/");
});

test("ASK-09: each tool reads as a plain progress line", () => {
  assert.equal(stepText("next_trains", { station: "KL Sentral" }), "Checking the next trains at KL Sentral");
  assert.equal(stepText("plan_ride", { from: "Taman Jaya", to: "KLCC" }), "Working out the trains from Taman Jaya to KLCC");
  assert.equal(stepText("other_lines", {}), "Checking how busy the other lines usually are");
  assert.equal(stepText("made_up", {}), "Checking the twin");
});
