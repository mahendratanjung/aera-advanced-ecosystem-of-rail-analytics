import { test } from "node:test";
import assert from "node:assert/strict";
import { searchStations } from "./stationSearch.ts";

const st = [
  { id: "KJ10", name: "KLCC" }, { id: "KJ15", name: "KL Sentral" }, { id: "KJ7", name: "Dato' Keramat" },
  { id: "KJ20", name: "Taman Jaya" }, { id: "KJ21", name: "Asia Jaya" }, { id: "KJ24", name: "Kelana Jaya" },
];

test("station search matches names, words and codes", () => {
  assert.deepEqual(searchStations(st, "sentral").map((s) => s.id), ["KJ15"]);
  assert.deepEqual(searchStations(st, "jaya").map((s) => s.id), ["KJ20", "KJ21", "KJ24"]);
  assert.deepEqual(searchStations(st, "dato keramat").map((s) => s.id), ["KJ7"]);
  assert.deepEqual(searchStations(st, "kj2").map((s) => s.id), ["KJ20", "KJ21", "KJ24"]);
  assert.equal(searchStations(st, "").length, st.length);
  assert.equal(searchStations(st, "zzz").length, 0);
});
