"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Input, Label, Select } from "@/components/Field";
import { api } from "@/lib/api";
import { useLine } from "@/lib/hooks";
import { useTwin } from "@/lib/store";
import type { Settings, User } from "@/lib/types";
import { AdminShell } from "./AdminShell";

function NumberField({ id, label, value, onChange, min, max, step = 1 }: {
  id: string; label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function SettingsForm() {
  const twins = useTwin((s) => s.twins);
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    api<Settings>("/admin/settings").then(setS).catch((e) => setMsg({ ok: false, text: e.message }));
  }, []);
  if (!s) return <p className="text-muted">Loading settings…</p>;
  const set = (fn: (d: Settings) => void) => {
    const next = structuredClone(s);
    fn(next);
    setS(next);
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setS(await api<Settings>("/admin/settings", { method: "PUT", json: s }));
      setMsg({ ok: true, text: "Saved. The twin has been recoloured with the new values." });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };
  return (
    <form onSubmit={save} className="space-y-6">
      <section className="panel p-4">
        <h2 className="mb-3 text-lg font-bold text-ink">Congestion thresholds (% of capacity)</h2>
        <div className="grid grid-cols-3 gap-3">
          <NumberField id="t-mod" label="Moderate from" value={s.thresholds.moderate} min={1} max={199} onChange={(v) => set((d) => { d.thresholds.moderate = v; })} />
          <NumberField id="t-busy" label="Busy from" value={s.thresholds.busy} min={1} max={199} onChange={(v) => set((d) => { d.thresholds.busy = v; })} />
          <NumberField id="t-crowd" label="Crowded from" value={s.thresholds.crowded} min={1} max={200} onChange={(v) => set((d) => { d.thresholds.crowded = v; })} />
        </div>
      </section>
      <section className="panel p-4">
        <h2 className="mb-3 text-lg font-bold text-ink">Alerts and devices</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <NumberField id="a-hold" label="Crowding hold (s)" value={s.alerts.crowd_hold_s} min={0} onChange={(v) => set((d) => { d.alerts.crowd_hold_s = v; })} />
          <NumberField id="a-clear" label="Clears after (s)" value={s.alerts.crowd_clear_s} min={0} onChange={(v) => set((d) => { d.alerts.crowd_clear_s = v; })} />
          <NumberField id="a-hb" label="Heartbeat window (s)" value={s.alerts.heartbeat_s} min={5} onChange={(v) => set((d) => { d.alerts.heartbeat_s = v; })} />
          <NumberField id="a-rate" label="Max crossings / s" value={s.ingest.max_crossings_per_s} min={1} onChange={(v) => set((d) => { d.ingest.max_crossings_per_s = v; })} />
        </div>
      </section>
      <section className="panel p-4">
        <h2 className="mb-3 text-lg font-bold text-ink">Trains</h2>
        <div className="grid grid-cols-2 gap-3">
          <NumberField id="tr-cap" label="Train capacity (to be confirmed)" value={s.train.capacity} min={50} onChange={(v) => set((d) => { d.train.capacity = v; })} />
          <NumberField id="tr-dwell" label="Default dwell (s)" value={s.train.default_dwell_s} min={5} onChange={(v) => set((d) => { d.train.default_dwell_s = v; })} />
        </div>
      </section>
      {Object.values(twins).map((t) => {
        const st = s.stations[t.station_id] ?? { source_mode: t.source_mode, scale_factor: t.scale_factor, boarding_enabled: true };
        const setSt = (patch: Partial<typeof st>) => set((d) => { d.stations[t.station_id] = { ...st, ...patch }; });
        return (
          <section key={t.station_id} className="panel p-4">
            <h2 className="mb-3 text-lg font-bold text-ink">Station {t.station_id}</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <NumberField id={`sf-${t.station_id}`} label="Passengers per crossing" value={st.scale_factor} min={1} max={100} onChange={(v) => setSt({ scale_factor: v })} />
              <div>
                <Label htmlFor={`sm-${t.station_id}`}>Data source</Label>
                <Select id={`sm-${t.station_id}`} value={st.source_mode} onChange={(e) => setSt({ source_mode: e.target.value as typeof st.source_mode })}>
                  <option value="device">Device</option><option value="mixed">Mixed</option><option value="sim">Simulator</option>
                </Select>
              </div>
              <label className="mt-6 flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={st.boarding_enabled} onChange={(e) => setSt({ boarding_enabled: e.target.checked })} className="h-4 w-4 accent-[var(--accent)]" />
                Apply boarding rule
              </label>
            </div>
            <p className="eyebrow mb-2 mt-4">Zone capacities</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {t.zones.map((z) => (
                <NumberField key={z.id} id={`cap-${z.id}`} label={z.name} min={1}
                  value={s.zone_capacity[`${t.station_id}:${z.id}`] ?? z.capacity}
                  onChange={(v) => set((d) => { d.zone_capacity[`${t.station_id}:${z.id}`] = v; })} />
              ))}
            </div>
          </section>
        );
      })}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary">Save settings</Button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-lvl-low" : "text-lvl-crowded"}`}>{msg.text}</p>}
      </div>
    </form>
  );
}

const EMPTY = { email: "", display_name: "", role: "operator" as User["role"], station_id: "", password: "", active: true };

function Users() {
  const { line } = useLine("KJ");
  const [users, setUsers] = useState<User[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<User[]>("/admin/users").then(setUsers).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const body = { ...form, station_id: form.role === "operator" ? form.station_id || null : null, password: form.password || null };
    try {
      await api(editing ? `/admin/users/${editing}` : "/admin/users", { method: editing ? "PUT" : "POST", json: body });
      setEditing(null);
      setForm(EMPTY);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <section aria-label="Users" className="mt-10">
      <h2 className="mb-3 text-xl font-bold text-ink">Users and roles</h2>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="panel overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="eyebrow"><tr><th className="p-2">User</th><th className="p-2">Role</th><th className="p-2">Station</th><th className="p-2"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody className="divide-y divide-subtle">
              {users.map((u) => (
                <tr key={u.id} className={u.active ? "" : "opacity-50"}>
                  <td className="p-2"><p className="text-ink">{u.display_name}</p><p className="text-xs text-muted">{u.email}</p></td>
                  <td className="p-2 capitalize text-ink">{u.role}</td>
                  <td className="p-2 text-muted">{u.station_id ?? "All"}</td>
                  <td className="p-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(u.id); setForm({ email: u.email, display_name: u.display_name, role: u.role, station_id: u.station_id ?? "", password: "", active: u.active }); }}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form onSubmit={submit} className="panel space-y-3 p-4">
          <h3 className="font-bold text-ink">{editing ? "Edit user" : "Add user"}</h3>
          <div><Label htmlFor="u-email">Email</Label><Input id="u-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><Label htmlFor="u-name">Display name</Label><Input id="u-name" required value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></div>
          <div>
            <Label htmlFor="u-role">Role</Label>
            <Select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as User["role"] })}>
              <option value="operator">Station operator</option><option value="admin">Admin</option>
            </Select>
          </div>
          {form.role === "operator" && (
            <div>
              <Label htmlFor="u-station">Assigned station</Label>
              <Select id="u-station" required value={form.station_id} onChange={(e) => setForm({ ...form, station_id: e.target.value })}>
                <option value="">Choose…</option>
                {line?.stations.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.name}</option>)}
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="u-pw">{editing ? "New password (optional)" : "Password"}</Label>
            <Input id="u-pw" type="password" minLength={8} required={!editing} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 accent-[var(--accent)]" /> Active
          </label>
          {error && <p role="alert" className="text-sm text-lvl-crowded">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" variant="primary">{editing ? "Save" : "Add user"}</Button>
            {editing && <Button variant="ghost" onClick={() => { setEditing(null); setForm(EMPTY); }}>Cancel</Button>}
          </div>
        </form>
      </div>
    </section>
  );
}

export function AdminSettings() {
  return (
    <AdminShell title="Settings and users">
      <SettingsForm />
      <Users />
    </AdminShell>
  );
}
