"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Input, Label, Select } from "@/components/Field";
import { Page, Section } from "@/components/Page";
import { api } from "@/lib/api";
import { klDate, klTime } from "@/lib/format";
import { useRequireRole } from "@/lib/guard";
import { useLine, useSimNow } from "@/lib/hooks";
import { useTwin } from "@/lib/store";

interface ScenarioInfo { id: string; name: string; description: string }
const SPEEDS = [1, 5, 10, 30, 60];
const KIND_LABEL = { delay: "Delay", hold: "Train held", suspend: "Section suspended", surge: "Event crowd" } as const;
/** Kinds listed on active disruptions; "insert" (extra train) is added from the Control room. */
const ACTIVE_LABEL: Record<string, string> = { ...KIND_LABEL, insert: "Extra train" };

/** Run the twin for demonstrations: scenarios, the clock and disruptions (ADM-04, SIM-03, SIM-04). */
export function SimulationControl() {
  const { user, ready } = useRequireRole("admin");
  const sim = useTwin((s) => s.sim);
  const now = useSimNow(1000);
  const { line } = useLine("KJ");
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [jump, setJump] = useState("18:00");
  const [form, setForm] = useState({ kind: "hold", stop_id: "KJ15", to_stop_id: "KJ13", direction_id: "", delay_s: "300", multiplier: "2.5", duration_min: "15", note: "" });

  useEffect(() => {
    api<ScenarioInfo[]>("/scenarios").then(setScenarios).catch((e) => setError(e.message));
  }, []);

  if (!ready || !user) return <Page title="Simulation"><p className="text-ink-2">Checking your session…</p></Page>;
  if (user.role !== "admin") return <Page title="Simulation"><p className="text-ink-2">This page is for admins.</p></Page>;

  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    fn().catch((e) => setError(e.message));
  };
  const clock = (body: object) => run(() => api("/admin/sim/clock", { method: "POST", json: body }));
  const name = (id: string | null) => line?.stations.find((s) => s.id === id)?.name ?? id;

  return (
    <Page wide title="Simulation" intro="Drive the twin for a demonstration. Every change reaches all open screens at once.">
      {error && <p role="alert" className="mb-6 rounded-sign border border-critical/50 p-3 text-sm text-critical">{error}</p>}
      <div className="grid gap-10 lg:grid-cols-[1fr_340px]">
        <div>
          <Section title="Scenarios" note={<>Active: <strong className="text-ink">{sim?.scenario.name ?? "…"}</strong></>}>
            <div className="grid gap-3 sm:grid-cols-2">
              {scenarios.map((s) => (
                <button key={s.id} type="button" onClick={() => run(() => api(`/admin/sim/scenarios/${s.id}`, { method: "POST" }))}
                  className={`card flex flex-col items-start justify-start p-4 text-left transition-colors hover:border-rule-strong ${sim?.scenario.id === s.id ? "border-accent" : ""}`}>
                  <p className="font-semibold text-ink">{s.name}</p>
                  <p className="mt-1 text-[13px] text-ink-2">{s.description}</p>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Add a disruption">
            <form className="card grid gap-4 p-4 sm:grid-cols-3" onSubmit={(e) => {
              e.preventDefault();
              run(() => api("/admin/sim/disruptions", { method: "POST", json: {
                kind: form.kind, stop_id: form.stop_id, to_stop_id: form.kind === "suspend" ? form.to_stop_id : null,
                direction_id: form.direction_id === "" ? null : Number(form.direction_id),
                delay_s: form.kind === "delay" ? Number(form.delay_s) : 0, multiplier: Number(form.multiplier),
                duration_min: form.duration_min ? Number(form.duration_min) : null, note: form.note,
              } }));
            }}>
              <div>
                <Label htmlFor="kind">What happens</Label>
                <Select id="kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="stop">{form.kind === "suspend" ? "From" : "At"}</Label>
                <Select id="stop" value={form.stop_id} onChange={(e) => setForm({ ...form, stop_id: e.target.value })}>
                  {line?.stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </div>
              {form.kind === "suspend" ? (
                <div>
                  <Label htmlFor="to">To</Label>
                  <Select id="to" value={form.to_stop_id} onChange={(e) => setForm({ ...form, to_stop_id: e.target.value })}>
                    {line?.stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                </div>
              ) : (
                <div>
                  <Label htmlFor="dir">Direction</Label>
                  <Select id="dir" value={form.direction_id} onChange={(e) => setForm({ ...form, direction_id: e.target.value })}>
                    <option value="">Both</option>
                    {line?.directions.map((d) => <option key={d.direction_id} value={d.direction_id}>Towards {d.headsign}</option>)}
                  </Select>
                </div>
              )}
              {form.kind === "delay" && (
                <div><Label htmlFor="delay">Delay (seconds)</Label><Input id="delay" type="number" min={30} value={form.delay_s} onChange={(e) => setForm({ ...form, delay_s: e.target.value })} /></div>
              )}
              {form.kind === "surge" && (
                <div><Label htmlFor="mult">Times the usual boarding</Label><Input id="mult" type="number" min={1.1} max={6} step={0.1} value={form.multiplier} onChange={(e) => setForm({ ...form, multiplier: e.target.value })} /></div>
              )}
              <div><Label htmlFor="dur">Minutes (blank: until cleared)</Label><Input id="dur" type="number" min={1} max={600} value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: e.target.value })} /></div>
              <div><Label htmlFor="note">Note for staff</Label><Input id="note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
              <div className="sm:col-span-3"><Button type="submit" variant="primary">Add disruption</Button></div>
            </form>
          </Section>

          <Section title="Active disruptions">
            {sim?.disruptions.length ? (
              <ul className="divide-y divide-rule border-y border-rule">
                {sim.disruptions.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                    <span className="text-ink">
                      <strong>{ACTIVE_LABEL[d.kind]}</strong> at {name(d.stop_id)}{d.to_stop_id && ` to ${name(d.to_stop_id)}`}
                      {d.kind === "delay" && `, ${Math.round(d.delay_s / 60)} min`}{d.kind === "surge" && `, ${d.multiplier}× boarding`}
                      <span className="text-ink-3"> · from {klTime(d.start_ms)}{d.end_ms ? ` to ${klTime(d.end_ms)}` : ", until cleared"}</span>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => run(() => api(`/admin/sim/disruptions/${d.id}`, { method: "DELETE" }))}>Clear</Button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-ink-2">Trains are running to the timetable.</p>}
          </Section>
        </div>

        <aside>
          <div className="card space-y-4 p-4 lg:sticky lg:top-20">
            <div>
              <p className="label">Simulated time</p>
              <p className="num text-3xl text-ink">{klTime(now, true)}</p>
              <p className="text-xs text-ink-3">{klDate(now)} · {sim?.clock.paused ? "paused" : sim?.clock.speed === 1 ? "real speed" : `×${sim?.clock.speed}`}</p>
            </div>
            <div role="group" aria-label="Speed" className="flex flex-wrap gap-1.5">
              {SPEEDS.map((s) => (
                <Button key={s} size="sm" variant={sim?.clock.speed === s ? "primary" : "secondary"} onClick={() => clock({ speed: s })}>
                  {s === 1 ? "Real speed" : `×${s}`}
                </Button>
              ))}
            </div>
            <Button className="w-full" onClick={() => clock({ paused: !sim?.clock.paused })}>{sim?.clock.paused ? "Resume" : "Pause"}</Button>
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); clock({ jump_to: jump }); }}>
              <div className="flex-1"><Label htmlFor="jump">Go to time</Label><Input id="jump" type="time" value={jump} onChange={(e) => setJump(e.target.value)} required /></div>
              <Button type="submit">Go</Button>
            </form>
            <button type="button" className="text-[13px] font-medium text-accent" onClick={() => clock({ jump_ms: Date.now(), speed: 1, paused: false })}>
              Back to the real time now
            </button>
          </div>
        </aside>
      </div>
    </Page>
  );
}
