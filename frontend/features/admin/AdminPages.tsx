"use client";

/** Admin: users and roles (ADM-02), crowding thresholds (ADM-03), audit log (ADM-05). */

import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { CrowdTag } from "@/components/Crowd";
import { Input, Label, Select } from "@/components/Field";
import { Page, Section } from "@/components/Page";
import { EmptyState, Skeleton } from "@/components/States";
import { api } from "@/lib/api";
import { CROWD, DEFAULT_BOUNDS } from "@/lib/crowd/levels";
import { klDate, klTime } from "@/lib/format";
import { useRequireRole } from "@/lib/guard";
import { useLine } from "@/lib/hooks";
import type { AuditEntry, User } from "@/lib/types";

function useAdmin(title: string) {
  const { user, ready } = useRequireRole("admin");
  if (!ready || !user) return <Page title={title}><p className="text-ink-2">Checking your session…</p></Page>;
  if (user.role !== "admin") return <Page title={title}><p className="text-ink-2">This page is for admins.</p></Page>;
  return null;
}

export function UsersPage() {
  const gate = useAdmin("Users");
  const { line } = useLine("KJ");
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ email: "", display_name: "", role: "operator", station_id: "KJ20", password: "" });
  const load = () => api<User[]>("/admin/users").then(setUsers).catch((e) => setError(e.message));
  useEffect(() => {
    if (!gate) void load();
  }, [gate]);
  if (gate) return gate;
  const name = (id: string | null) => line?.stations.find((s) => s.id === id)?.name ?? id ?? "Whole line";
  const save = (u: User, patch: Partial<User>) => {
    setError(null);
    api(`/admin/users/${u.id}`, { method: "PUT", json: { ...u, ...patch } }).then(load).catch((e) => setError(e.message));
  };
  return (
    <Page wide title="Users" intro="Who can sign in. Riders never need an account; operators run line control, admins also run the simulation and settings.">
      {error && <p role="alert" className="mb-4 text-sm text-critical">{error}</p>}
      <Section title="Accounts">
        {!users ? <Skeleton className="h-40" /> : (
          <ul className="card divide-y divide-rule">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">{u.display_name}</span>
                  <span className="block text-[13px] text-ink-3">{u.email} · {u.role === "admin" ? "Admin" : `Operator, ${name(u.station_id)}`}</span>
                </span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${u.active ? "bg-accent-soft text-accent" : "bg-surface-2 text-ink-3"}`}>{u.active ? "Active" : "Disabled"}</span>
                <Button size="sm" onClick={() => save(u, { active: !u.active })}>{u.active ? "Disable" : "Enable"}</Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Add a user">
        <form className="card grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          api("/admin/users", { method: "POST", json: { ...form, station_id: form.role === "operator" ? form.station_id : null } })
            .then(() => { setForm({ ...form, email: "", display_name: "", password: "" }); return load(); })
            .catch((err) => setError(err.message));
        }}>
          <div><Label htmlFor="u-name">Name</Label><Input id="u-name" required value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></div>
          <div><Label htmlFor="u-email">Email</Label><Input id="u-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><Label htmlFor="u-role">Role</Label>
            <Select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="operator">Operator</option><option value="admin">Admin</option></Select></div>
          <div><Label htmlFor="u-st">Station</Label>
            <Select id="u-st" disabled={form.role !== "operator"} value={form.station_id} onChange={(e) => setForm({ ...form, station_id: e.target.value })}>
              {line?.stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select></div>
          <div><Label htmlFor="u-pw">Password</Label><Input id="u-pw" type="password" minLength={8} required autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          <div className="sm:col-span-2 lg:col-span-5"><Button type="submit" variant="primary">Add user</Button></div>
        </form>
      </Section>
    </Page>
  );
}

type SettingsBody = Record<string, unknown> & { crowd_levels: number[] };

export function CrowdSettingsPage() {
  const gate = useAdmin("Crowding levels");
  const [settings, setSettings] = useState<SettingsBody | null>(null);
  const [bounds, setBounds] = useState<number[]>(DEFAULT_BOUNDS);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (gate) return;
    api<SettingsBody>("/admin/settings").then((s) => {
      setSettings(s);
      setBounds(s.crowd_levels ?? DEFAULT_BOUNDS);
    }).catch((e) => setMsg(e.message));
  }, [gate]);
  if (gate) return gate;
  const valid = bounds.every((b, i) => b > (i ? bounds[i - 1] : 0)) && bounds[3] <= 200;
  const save = (next: number[]) => {
    if (!settings) return;
    setMsg(null);
    api<SettingsBody>("/admin/settings", { method: "PUT", json: { ...settings, crowd_levels: next } })
      .then((s) => { setSettings(s); setMsg("Saved. Every screen uses the new levels now."); })
      .catch((e) => setMsg(e.message));
  };
  return (
    <Page title="Crowding levels" intro="Where each level starts, in percent of an 800-person train. This is a product decision, not a data fact: the words riders see change with it.">
      {!settings ? <Skeleton className="h-48" /> : (
        <div className="card max-w-xl p-5">
          <ol className="space-y-3">
            <li className="flex items-center justify-between gap-3"><CrowdTag loadPct={0} /><span className="num text-sm text-ink-3">from 0%</span></li>
            {CROWD.slice(1).map((c, i) => (
              <li key={c.level} className="flex items-center justify-between gap-3">
                <CrowdTag loadPct={bounds[i] + 0.1} />
                <label className="flex items-center gap-2 text-sm text-ink-2">from
                  <Input type="number" min={1} max={200} step={1} value={bounds[i]} aria-label={`${c.name} starts at percent`}
                    onChange={(e) => setBounds(bounds.map((b, j) => (j === i ? Number(e.target.value) : b)))} className="w-24! text-right" />%
                </label>
              </li>
            ))}
          </ol>
          {!valid && <p role="alert" className="mt-3 text-sm text-critical">Each level must start above the one before, and Packed at 200% or less.</p>}
          <div className="mt-5 flex flex-wrap gap-3">
            <Button variant="primary" disabled={!valid} onClick={() => save(bounds)}>Save levels</Button>
            <Button onClick={() => { setBounds(DEFAULT_BOUNDS); save(DEFAULT_BOUNDS); }}>Back to defaults</Button>
          </div>
          {msg && <p role="status" className="mt-3 text-sm text-ink-2">{msg}</p>}
        </div>
      )}
    </Page>
  );
}

export function AuditPage() {
  const gate = useAdmin("Audit log");
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!gate) api<AuditEntry[]>("/admin/audit?limit=300").then(setRows).catch((e) => setError(e.message));
  }, [gate]);
  if (gate) return gate;
  return (
    <Page wide title="Audit log" intro="Every change to settings, users, scenarios, disruptions, extra trains and notices, newest first.">
      {error && <EmptyState title="The audit log is unavailable" body={error} />}
      {!rows ? <Skeleton className="h-64" /> : rows.length === 0 ? <EmptyState title="Nothing has changed yet" /> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-rule text-ink-3"><tr><th className="px-4 py-2 font-semibold">When</th><th className="px-4 py-2 font-semibold">Who</th><th className="px-4 py-2 font-semibold">What</th><th className="px-4 py-2 font-semibold">Target</th></tr></thead>
            <tbody className="divide-y divide-rule">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num whitespace-nowrap px-4 py-2 text-ink-2">{klDate(r.ts_ms)} {klTime(r.ts_ms)}</td>
                  <td className="px-4 py-2 text-ink-2">{r.actor}</td>
                  <td className="px-4 py-2 font-semibold text-ink">{r.action}</td>
                  <td className="px-4 py-2 text-ink-2">{r.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
