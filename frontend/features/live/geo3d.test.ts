import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TrackFrame, carPoses, dimsAt, TUNNEL_M } from "./geo3d.ts";

const root = new URL("../../../", import.meta.url);
const line = JSON.parse(readFileSync(new URL("data/lines/KJ.json", root), "utf8"));
const frame = new TrackFrame(line);
const dims = dimsAt(17, 3.1);

test("track frame keeps distances in metres", () => {
  const a = frame.at(20000);
  const b = frame.at(20500);
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  assert.ok(chord > 400 && chord <= 501, `500 m along the line is ${chord} m apart`);
  assert.ok(Math.abs(Math.hypot(a.tx, a.ty) - 1) < 1e-9);
});

test("cars run nose to tail on the left-hand track", () => {
  for (const sign of [1, -1]) {
    const cars = carPoses(frame, dims, 20000, sign);
    assert.deepEqual(cars.map((c) => c.kind), ["front", "mid", "mid", "rear"]);
    for (let i = 0; i < 3; i++) {
      const gap = Math.hypot(cars[i].x - cars[i + 1].x, cars[i].y - cars[i + 1].y);
      assert.ok(Math.abs(gap - (dims.carLength + dims.carGap)) < 1, `car spacing ${gap}`);
    }
    const p = frame.at(20000);
    const mid = { x: (cars[1].x + cars[2].x) / 2, y: (cars[1].y + cars[2].y) / 2 };
    const hx = Math.cos(cars[1].heading);
    const hy = Math.sin(cars[1].heading);
    assert.ok(hx * p.tx * sign + hy * p.ty * sign > 0.95, "cars face the way they travel");
    const side = hx * (mid.y - p.y) - hy * (mid.x - p.x); // > 0 when left of travel
    assert.ok(side > 0, "train keeps left");
    assert.ok(Math.abs(Math.hypot(mid.x - p.x, mid.y - p.y) - dims.trackOffset) < 0.5);
  }
});

test("cars in the tunnel run at ground level", () => {
  const mid = (TUNNEL_M[0] + TUNNEL_M[1]) / 2;
  assert.ok(carPoses(frame, dims, mid, 1).every((c) => c.ug && c.z < 1));
  assert.ok(carPoses(frame, dims, 20000, 1).every((c) => !c.ug && c.z === dims.deckTop));
});
