"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { DeviceRow } from "@/components/DeviceRow";
import { Input, Label, Select } from "@/components/Field";
import { api } from "@/lib/api";
import { useTwin } from "@/lib/store";
import { AdminShell } from "./AdminShell";

interface DevicesData {
  ingest: { accepted: number; rejected: Record<string, number>; rejected_total: number };
  outbound: { topic: string; payload: unknown }[];
}

export function AdminDevices() {
  const devices = useTwin((s) => s.devices);
  const twins = useTwin((s) => s.twins);
  const [data, setData] = useState<DevicesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ id: "", station_id: "", name: "", position: "" });

  useEffect(() => {
    const load = () => api<DevicesData>("/admin/devices").then(setData).catch((e) => setError(e.message));
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const stations = Object.keys(twins);
  const list = Object.values(devices).sort((a, b) => Number(a.retired) - Number(b.retired) || a.id.localeCompare(b.id));
  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    fn().catch((e) => setError(e.message));
  };

  return (
    <AdminShell title="Devices">
      {error && <p role="alert" className="mb-4 text-sm text-lvl-crowded">{error}</p>}
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <section aria-label="Device registry">
          <h2 className="mb-2 text-lg font-bold text-ink">Registry and health</h2>
          <ul className="panel divide-y divide-subtle px-4">
            {list.map((d) => (
              <DeviceRow key={d.id} device={d} actions={!d.retired && d.kind !== "sim" ? (
                <Button size="sm" variant="ghost" onClick={() => confirm(`Retire ${d.id}? It will stop being trusted for counts.`) && run(() => api(`/admin/devices/${d.id}/retire`, { method: "POST" }))}>
                  Retire
                </Button>
              ) : undefined} />
            ))}
          </ul>
          {data && (
            <>
              <h2 className="mb-2 mt-6 text-lg font-bold text-ink">Ingestion</h2>
              <p className="text-sm text-muted">
                {data.ingest.accepted} accepted · {data.ingest.rejected_total} rejected
                {data.ingest.rejected_total > 0 && ` (${Object.entries(data.ingest.rejected).map(([k, v]) => `${k.replace("_", " ")} ${v}`).join(", ")})`}
              </p>
              <h2 className="mb-2 mt-6 text-lg font-bold text-ink">Commands sent to the model</h2>
              {data.outbound.length ? (
                <ul className="space-y-1">
                  {data.outbound.slice(-6).reverse().map((o, i) => (
                    <li key={i} className="panel overflow-x-auto p-2">
                      <p className="tabular text-xs text-cyan">{o.topic}</p>
                      <pre className="tabular whitespace-pre-wrap text-[11px] text-muted">{JSON.stringify(o.payload)}</pre>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted">No commands yet.</p>}
            </>
          )}
        </section>
        <section aria-label="Register a device">
          <h2 className="mb-2 text-lg font-bold text-ink">Register a device</h2>
          <form className="panel space-y-3 p-4" onSubmit={(e) => {
            e.preventDefault();
            run(() => api("/admin/devices", { method: "POST", json: { ...form, station_id: form.station_id || stations[0], position: form.position || null } })
              .then(() => setForm({ id: "", station_id: "", name: "", position: "" })));
          }}>
            <div><Label htmlFor="dev-id">Device id</Label><Input id="dev-id" required pattern="[A-Za-z0-9_.\-]{2,40}" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="esp32-03" /></div>
            <div>
              <Label htmlFor="dev-st">Station</Label>
              <Select id="dev-st" value={form.station_id || stations[0] || ""} onChange={(e) => setForm({ ...form, station_id: e.target.value })}>
                {stations.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
            <div><Label htmlFor="dev-name">Name</Label><Input id="dev-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label htmlFor="dev-pos">Sensor position</Label><Input id="dev-pos" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="gate-main, env-concourse" /></div>
            <Button type="submit" variant="primary">Register</Button>
            <p className="text-xs text-muted">Sensors are bound to devices in the station definition file. The device publishes on aera/v1/&lt;station&gt;/&lt;device id&gt;/…</p>
          </form>
        </section>
      </div>
    </AdminShell>
  );
}
