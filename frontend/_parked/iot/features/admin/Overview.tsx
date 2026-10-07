"use client";

import { useEffect, useState } from "react";
import { AlertItem } from "@/components/AlertItem";
import { CongestionPill } from "@/components/Congestion";
import { api } from "@/lib/api";
import { klTime } from "@/lib/format";
import { useLine } from "@/lib/hooks";
import { useTwin } from "@/lib/store";
import type { AuditEntry } from "@/lib/types";
import { AdminShell, Stat } from "./AdminShell";

interface OverviewData {
  devices: { total: number; online: number; offline: number };
  alerts: { open: number; high: number };
  network: { stations: number; busy_or_worse: number; avg_percent: number };
  ingest: { accepted: number; rejected: Record<string, number>; rejected_total: number };
  bus: { name: string; connected: boolean };
  realtime_clients: number;
  sim_time: string;
}

export function AdminOverview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const alerts = useTwin((s) => s.alerts);
  const stations = useTwin((s) => s.stations);
  const liveAudit = useTwin((s) => s.audit);
  const { line } = useLine("KJ");

  useEffect(() => {
    const load = () => {
      api<OverviewData>("/admin/overview").then(setData).catch(() => {});
      api<AuditEntry[]>("/admin/audit?limit=50").then(setAudit).catch(() => {});
    };
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [liveAudit.length]);

  const open = Object.values(alerts).filter((a) => a.state !== "resolved").sort((a, b) => b.started_at_ms - a.started_at_ms);
  return (
    <AdminShell title="System overview">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Devices online" value={data ? `${data.devices.online}/${data.devices.total}` : "…"} hint={data ? `${data.devices.offline} offline` : undefined}
          tone={data && data.devices.offline > 0 ? "bad" : "ok"} />
        <Stat label="Open alerts" value={data?.alerts.open ?? "…"} hint={data ? `${data.alerts.high} high severity` : undefined} tone={data && data.alerts.high ? "bad" : undefined} />
        <Stat label="Network load" value={data ? `${data.network.avg_percent}%` : "…"} hint={data ? `${data.network.busy_or_worse} stations busy or crowded` : undefined} />
        <Stat label="Messages" value={data?.ingest.accepted ?? "…"} hint={data ? `${data.ingest.rejected_total} rejected · bus ${data.bus.name}${data.bus.connected ? "" : " (down)"}` : undefined} />
      </div>
      {data && data.ingest.rejected_total > 0 && (
        <p className="mt-2 text-xs text-muted">
          Rejected by reason: {Object.entries(data.ingest.rejected).map(([k, v]) => `${k.replace("_", " ")} ${v}`).join(" · ")}
        </p>
      )}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section aria-label="Open alerts">
          <h2 className="mb-2 text-lg font-bold text-ink">Open alerts, all stations</h2>
          {open.length ? <ul className="space-y-2">{open.map((a) => <AlertItem key={a.id} alert={a} />)}</ul> : <p className="text-sm text-muted">None.</p>}
        </section>
        <section aria-label="Stations">
          <h2 className="mb-2 text-lg font-bold text-ink">Stations</h2>
          <ul className="panel divide-y divide-subtle px-4">
            {line?.stations.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-1.5 text-sm">
                <span className="text-ink"><span className="tabular mr-2 text-faint">{s.id}</span>{s.name}</span>
                {stations[s.id] && <CongestionPill level={stations[s.id].level} percent={stations[s.id].percent} size="sm" />}
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section aria-label="Audit log" className="mt-6">
        <h2 className="mb-2 text-lg font-bold text-ink">Audit log</h2>
        <div className="panel overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="eyebrow"><tr><th className="p-2">Time</th><th className="p-2">Actor</th><th className="p-2">Action</th><th className="p-2">Target</th></tr></thead>
            <tbody className="divide-y divide-subtle">
              {audit.map((e) => (
                <tr key={e.id}>
                  <td className="tabular p-2 text-faint">{klTime(e.ts_ms, true)}</td>
                  <td className="p-2 text-ink">{e.actor}</td>
                  <td className="p-2 text-muted">{e.action}</td>
                  <td className="p-2 text-muted">{e.target}{e.station_id && ` · ${e.station_id}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AdminShell>
  );
}
