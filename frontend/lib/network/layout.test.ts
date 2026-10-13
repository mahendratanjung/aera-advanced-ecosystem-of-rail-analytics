import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { layout, linkedPlaces, pointAt, searchPlaces } from "./layout.ts";
import { LINES } from "./schematic.ts";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), "utf8"));
const lay = layout();

test("every Rapid Rail station in the GTFS network is on the map, on its own line", () => {
  const net = read("data/network/rapid.json") as { lines: { id: string; stops: { id: string }[] }[] };
  for (const l of net.lines) {
    const drawn = lay.line[l.id];
    assert.ok(drawn, `line ${l.id} is drawn`);
    const ids = new Set(drawn.stations.map((s) => s.id));
    for (const s of l.stops) assert.ok(ids.has(s.id), `${s.id} on ${l.id}`);
    assert.equal(drawn.stations.length, l.stops.length, `${l.id} has no extra stations`);
  }
});

test("the Kelana Jaya Line runs in timetable order along its drawn path", () => {
  const kj = read("data/lines/KJ.json") as { stations: { id: string; distance_m: number }[] };
  const byDistance = [...kj.stations].sort((a, b) => a.distance_m - b.distance_m).map((s) => s.id);
  const drawn = lay.line.KJ.stations;
  const s = drawn.map((x) => x.s);
  assert.deepEqual(s, [...s].sort((a, b) => a - b), "station distances increase along the path");
  const order = drawn.map((x) => x.id);
  assert.ok(JSON.stringify(order) === JSON.stringify(byDistance) || JSON.stringify(order) === JSON.stringify([...byDistance].reverse()));
});

test("stations sit on their line and distinct stops do not overlap", () => {
  for (const l of lay.lines) {
    for (const st of l.stations) {
      const { p } = pointAt(l, st.s);
      assert.ok(Math.hypot(p[0] - st.at[0], p[1] - st.at[1]) < 2.5, `${st.id} is on the drawn ${l.def.id} line`);
    }
  }
  const all = Object.values(lay.station);
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      if (lay.placeOf[a.id] === lay.placeOf[b.id]) continue;
      assert.ok(Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) >= 6, `${a.id} and ${b.id} are apart`);
    }
  }
});

test("labels stay inside the map and clear of other stations", () => {
  const { x, y, w, h } = lay.bounds;
  for (const p of lay.places) {
    const b = p.label!.box;
    assert.ok(b.x >= x && b.y >= y && b.x + b.w <= x + w && b.y + b.h <= y + h, `${p.name} label inside the map`);
    for (const s of Object.values(lay.station)) {
      if (p.stations.includes(s)) continue;
      const inside = s.at[0] > b.x + 0.5 && s.at[0] < b.x + b.w - 0.5 && s.at[1] > b.y + 0.5 && s.at[1] < b.y + b.h - 0.5;
      assert.ok(!inside, `${p.name} label covers ${s.id}`);
    }
  }
});

test("interchanges keep their platforms together, walkways join separate stations", () => {
  const ks = lay.placeOf.KJ15;
  assert.equal(ks.name, "KL Sentral");
  assert.ok(ks.hub);
  assert.deepEqual(new Set(ks.stations.map((s) => s.line.id)), new Set(["K1", "K2", "KJ", "SK", "E6", "E7"]));
  for (const s of ks.stations) assert.ok(s.at[0] >= ks.box.x && s.at[0] <= ks.box.x + ks.box.w && s.at[1] >= ks.box.y && s.at[1] <= ks.box.y + ks.box.h);
  assert.ok(linkedPlaces(lay, ks).some((p) => p.stations.some((s) => s.id === "MR1")), "monorail KL Sentral by walkway");
  for (const p of lay.places.filter((x) => x.stations.length > 1 && !x.hub)) {
    for (const s of p.stations) assert.ok(Math.hypot(s.at[0] - p.center[0], s.at[1] - p.center[1]) < 12, `${s.id} close to ${p.name}`);
  }
});

test("search finds stations by code, name and word, interchanges first", () => {
  assert.equal(searchPlaces(lay, "KJ15")[0].name, "KL Sentral");
  assert.equal(searchPlaces(lay, "masjid")[0].name, "Masjid Jamek");
  assert.equal(searchPlaces(lay, "bintang")[0].name, "Bukit Bintang");
  assert.ok(searchPlaces(lay, "klia").length >= 2);
  assert.deepEqual(searchPlaces(lay, "zzz"), []);
});

test("all thirteen lines of the poster are drawn with a badge", () => {
  assert.deepEqual(LINES.map((l) => l.badge), ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "B1"]);
  for (const l of LINES) assert.ok(l.badges.length >= 1);
});
