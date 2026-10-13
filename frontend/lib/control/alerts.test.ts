import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LineModel } from "../sim/trains.ts";
import { CrowdEngine, type CrowdModelData } from "../crowd/model.ts";
import type { Disruption } from "../types";
import { lineAlerts } from "./alerts.ts";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), "utf8"));
const data = { ...read("data/lines/KJ.json"), twin_stations: [] };
const engine = new CrowdEngine(new LineModel(data), read("data/models/KJ.json") as CrowdModelData);
const kl = (h: number, m = 0) => Date.UTC(2026, 9, 6, h - 8, m) / 1000; // Tuesday

test("a quiet midday has no line alerts; other lines can still be flagged", () => {
  const t = kl(11, 30);
  const a = lineAlerts(engine, data, engine.live(t, []), [{ name: "MRT Kajang", max: 97, from: "TRX", to: "Cochrane" }]);
  assert.deepEqual(a.map((x) => x.kind), ["other"]);
});

test("a held train raises held and gap alerts, worst first", () => {
  const t = kl(18, 10);
  const hold: Disruption = { id: "h", kind: "hold", stop_id: "KJ13", to_stop_id: null, direction_id: 0, delay_s: 900, multiplier: 1,
    start_ms: (t - 600) * 1000, end_ms: (t + 600) * 1000, note: "" };
  const a = lineAlerts(engine, data, engine.live(t, [hold]));
  assert.ok(a.some((x) => x.kind === "held" && x.severity === 3), a.map((x) => x.title).join("; "));
  assert.ok(a.some((x) => x.kind === "packed" || x.kind === "ahead"));
  for (let i = 1; i < a.length; i++) assert.ok(a[i - 1].severity >= a[i].severity);
  assert.ok(a.every((x) => x.kind === "other" || x.trip));
});
