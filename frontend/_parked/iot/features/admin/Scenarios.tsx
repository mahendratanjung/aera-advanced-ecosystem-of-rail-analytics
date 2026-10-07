"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { ClockChip } from "@/components/ClockChip";
import { Input, Label, Select } from "@/components/Field";
import { api } from "@/lib/api";
import { klTime } from "@/lib/format";
import { useLine } from "@/lib/hooks";
import { useTwin } from "@/lib/store";
import { AdminShell } from "./AdminShell";

interface ScenarioInfo { id: string; name: string; description: string }

const SPEEDS = [1, 5, 10, 30, 60];

export function ScenarioDirector() {
  const sim = useTwin((s) => s.sim);
  const twins = useTwin((s) => s.twins);
  const { line } = useLine("KJ");
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [jump, setJump] = useState("17:30");
  const [form, setForm] = useState({ kind: "delay", stop_id: "KJ15", to_stop_id: "KJ13", direction_id: "", delay_s: "300", duration_min: "15", note: "" });

  useEffect(() => {
    api<ScenarioInfo[]>("/scenarios").then(setScenarios).catch((e) => setError(e.message));
  }, []);

  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    fn().catch((e) => setError(e.message));
  };
  const clock = (body: object) => run(() => api("/admin/sim/clock", { method: "POST", json: body }));
  const stationName = (id: string | null) => line?.stations.find((s) => s.id === id)?.name ?? id;

  return (
    <AdminShell title="Scenario director">
      {error && <p role="alert" className="mb-4 rounded border border-lvl-crowded/50 p-2 text-sm text-lvl-crowded">{error}</p>}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section aria-label="Scenarios">
          <h2 className="mb-1 text-lg font-bold text-ink">Scenarios</h2>
          <p className="mb-3 text-sm text-muted">Repeatable demonstrations. Active: <span className="text-cyan">{sim?.scenario.name ?? "…"}</span></p>
          <div className="grid gap-3 sm:grid-cols-2">
            {scenarios.map((s) => (
              <button key={s.id} type="button" onClick={() => run(() => api(`/admin/sim/scenarios/${s.id}`, { method: "POST" }))}
                className={`panel p-4 text-left transition hover:border-cyan ${sim?.scenario.id === s.id ? "border-cyan" : ""} ${s.id === "reset" ? "border-dashed" : ""}`}>
                <p className="font-semibold text-ink">{s.name}</p>
                <p className="mt-1 text-sm text-muted">{s.description}</p>
              </button>
            ))}
          </div>

          <h2 className="mb-2 mt-8 text-lg font-bold text-ink">Inject a disruption</h2>
          <form className="panel grid gap-3 p-4 sm:grid-cols-3" onSubmit={(e) => {
            e.preventDefault();
            run(() => api("/admin/sim/disruptions", { method: "POST", json: {
              kind: form.kind, stop_id: form.stop_id, to_stop_id: form.kind === "suspend" ? form.to_stop_id : null,
              direction_id: form.direction_id === "" ? null : Number(form.direction_id),
              delay_s: form.kind === "delay" ? Number(form.delay_s) : 0,
              duration_min: form.duration_min ? Number(form.duration_min) : null, note: form.note,
            } }));
          }}>
            <div>
              <Label htmlFor="d-kind">Kind</Label>
              <Select id="d-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="delay">Delay at a station</option>
                <option value="hold">Hold trains at a station</option>
                <option value="suspend">Suspend a section</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="d-stop">{form.kind === "suspend" ? "From station" : "Station"}</Label>
              <Select id="d-stop" value={form.stop_id} onChange={(e) => setForm({ ...form, stop_id: e.target.value })}>
                {line?.stations.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.name}</option>)}
              </Select>
            </div>
            {form.kind === "suspend" ? (
              <div>
                <Label htmlFor="d-to">To station</Label>
                <Select id="d-to" value={form.to_stop_id} onChange={(e) => setForm({ ...form, to_stop_id: e.target.value })}>
                  {line?.stations.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.name}</option>)}
                </Select>
              </div>
            ) : (
              <div>
                <Label htmlFor="d-dir">Direction</Label>
                <Select id="d-dir" value={form.direction_id} onChange={(e) => setForm({ ...form, direction_id: e.target.value })}>
                  <option value="">Both</option>
                  {line?.directions.map((d) => <option key={d.direction_id} value={d.direction_id}>To {d.headsign}</option>)}
                </Select>
              </div>
            )}
            {form.kind === "delay" && (
              <div>
                <Label htmlFor="d-delay">Delay (seconds)</Label>
                <Input id="d-delay" type="number" min={30} max={10800} value={form.delay_s} onChange={(e) => setForm({ ...form, delay_s: e.target.value })} />
              </div>
            )}
            <div>
              <Label htmlFor="d-dur">Lasts (minutes, empty = until cleared)</Label>
              <Input id="d-dur" type="number" min={1} max={600} value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="d-note">Note</Label>
              <Input id="d-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Shown to operators" />
            </div>
            <div className="sm:col-span-3"><Button type="submit" variant="primary">Inject disruption</Button></div>
          </form>

          <h2 className="mb-2 mt-6 text-lg font-bold text-ink">Active disruptions</h2>
          {sim?.disruptions.length ? (
            <ul className="space-y-2">
              {sim.disruptions.map((d) => (
                <li key={d.id} className="panel flex items-center justify-between gap-3 p-3 text-sm">
                  <span className="text-ink">
                    <span className="font-semibold capitalize">{d.kind}</span> at {stationName(d.stop_id)}
                    {d.to_stop_id && ` to ${stationName(d.to_stop_id)}`}
                    {d.kind === "delay" && ` · ${Math.round(d.delay_s / 60)} min`}
                    <span className="text-muted"> · from {klTime(d.start_ms)}{d.end_ms ? ` until ${klTime(d.end_ms)}` : ", until cleared"}</span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => run(() => api(`/admin/sim/disruptions/${d.id}`, { method: "DELETE" }))}>Clear</Button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">Trains are running to the timetable.</p>}
        </section>

        <aside className="space-y-4">
          <section aria-label="Simulation clock" className="panel space-y-3 p-4">
            <h2 className="text-lg font-bold text-ink">Simulation clock</h2>
            <ClockChip className="border-0 bg-transparent p-0" />
            <div role="group" aria-label="Speed" className="flex flex-wrap gap-1">
              {SPEEDS.map((s) => (
                <Button key={s} size="sm" variant={sim?.clock.speed === s ? "primary" : "outline"} onClick={() => clock({ speed: s })}>
                  {s === 1 ? "Real time" : `×${s}`}
                </Button>
              ))}
            </div>
            <Button onClick={() => clock({ paused: !sim?.clock.paused })}>{sim?.clock.paused ? "Resume" : "Pause"}</Button>
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); clock({ jump_to: jump }); }}>
              <div className="flex-1">
                <Label htmlFor="jump">Jump to time of day</Label>
                <Input id="jump" type="time" value={jump} onChange={(e) => setJump(e.target.value)} required />
              </div>
              <Button type="submit">Jump</Button>
            </form>
            <Button variant="ghost" size="sm" onClick={() => clock({ jump_ms: Date.now(), speed: 1, paused: false })}>Back to real time now</Button>
          </section>
          <section aria-label="Data source" className="panel space-y-3 p-4">
            <h2 className="text-lg font-bold text-ink">Data source per station</h2>
            <p className="text-sm text-muted">Device uses only the scale model. Sim uses the simulator. Mixed uses sensors that are online and fills the gaps with the simulator.</p>
            {Object.values(twins).map((t) => (
              <div key={t.station_id}>
                <p className="mb-1 text-sm font-semibold text-ink">{stationName(t.station_id)}</p>
                <div role="group" aria-label={`Source for ${t.station_id}`} className="flex gap-1">
                  {(["device", "mixed", "sim"] as const).map((m) => (
                    <Button key={m} size="sm" variant={t.source_mode === m ? "primary" : "outline"}
                      onClick={() => run(() => api(`/admin/stations/${t.station_id}/source-mode`, { method: "PUT", json: { mode: m } }))}>
                      {m}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </AdminShell>
  );
}
