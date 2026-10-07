"use client";

import { useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/AppNav";
import { Button } from "@/components/Button";
import { Select } from "@/components/Field";
import { EmptyState } from "@/components/States";
import { api } from "@/lib/api";
import { klTime } from "@/lib/format";
import { useRequireRole } from "@/lib/guard";
import { useTwin } from "@/lib/store";

type Bucket = { bucket_ms: number; avg_count: number; max_count: number; level: string; partial?: boolean };

const W = 720;
const H = 200;

function OccupancyChart({ rows, capacity, thresholds }: { rows: Bucket[]; capacity: number; thresholds: { moderate: number; busy: number; crowded: number } }) {
  if (rows.length < 2) return <EmptyState title="Not enough history yet" body="Occupancy is stored in one-minute buckets. Come back after a few minutes." />;
  const t0 = rows[0].bucket_ms;
  const t1 = rows[rows.length - 1].bucket_ms || t0 + 1;
  const maxY = Math.max(capacity, ...rows.map((r) => r.max_count)) * 1.05;
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v: number) => H - (v / maxY) * H;
  const path = rows.map((r, i) => `${i ? "L" : "M"}${x(r.bucket_ms).toFixed(1)},${y(r.avg_count).toFixed(1)}`).join(" ");
  const band = rows.map((r, i) => `${i ? "L" : "M"}${x(r.bucket_ms).toFixed(1)},${y(r.max_count).toFixed(1)}`).join(" ");
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" role="img" aria-label="Average and peak occupancy per minute">
        {(["moderate", "busy", "crowded"] as const).map((k) => (
          <g key={k}>
            <line x1={0} x2={W} y1={y((capacity * thresholds[k]) / 100)} y2={y((capacity * thresholds[k]) / 100)} stroke={`var(--lvl-${k})`} strokeDasharray="4 4" strokeWidth={1} opacity={0.6} />
            <text x={W - 4} y={y((capacity * thresholds[k]) / 100) - 3} textAnchor="end" fontSize={10} fill={`var(--lvl-${k})`}>{k}</text>
          </g>
        ))}
        <path d={band} fill="none" stroke="var(--text-muted)" strokeWidth={1} opacity={0.6} />
        <path d={path} fill="none" stroke="var(--brand-cyan)" strokeWidth={2} />
        <text x={0} y={H + 14} fontSize={10} fill="var(--text-faint)">{klTime(t0)}</text>
        <text x={W} y={H + 14} fontSize={10} fill="var(--text-faint)" textAnchor="end">{klTime(t1)}</text>
      </svg>
      <figcaption className="mt-1 text-xs text-muted">Cyan: average per minute. Grey: peak within the minute. Dashed: level thresholds.</figcaption>
    </figure>
  );
}

function toCsv(zoneId: string, rows: Bucket[]): string {
  const head = "zone_id,bucket_utc,avg_count,max_count,level";
  return [head, ...rows.map((r) => `${zoneId},${new Date(r.bucket_ms).toISOString()},${r.avg_count},${r.max_count},${r.level}`)].join("\n");
}

export function Analytics() {
  const { user, ready } = useRequireRole("operator");
  const twins = useTwin((s) => s.twins);
  const alerts = useTwin((s) => s.alerts);
  const settings = useTwin((s) => s.settings);
  const stationIds = Object.keys(twins).filter((id) => user?.role === "admin" || user?.station_id === id);
  const [station, setStation] = useState<string | null>(null);
  const [zone, setZone] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(120);
  const [history, setHistory] = useState<Record<string, Bucket[]> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sid = station ?? stationIds[0] ?? null;
  const twin = sid ? twins[sid] : undefined;
  const zid = zone ?? twin?.zones[0]?.id ?? null;

  useEffect(() => {
    if (!sid) return;
    const load = () => api<Record<string, Bucket[]>>(`/stations/${sid}/history?minutes=${minutes}`).then(setHistory).catch((e) => setError(e.message));
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [sid, minutes]);

  const summary = useMemo(() => {
    const byType: Record<string, { count: number; resolved: number; totalMs: number }> = {};
    for (const a of Object.values(alerts)) {
      if (sid && a.station_id !== sid) continue;
      const s = (byType[a.type] ??= { count: 0, resolved: 0, totalMs: 0 });
      s.count += 1;
      if (a.resolved_at_ms) {
        s.resolved += 1;
        s.totalMs += a.resolved_at_ms - a.started_at_ms;
      }
    }
    return byType;
  }, [alerts, sid]);

  if (!ready || !user) return <div className="p-8 text-muted">Checking your session…</div>;
  const rows = (zid && history?.[zid]) || [];
  const capacity = twin?.zones.find((z) => z.id === zid)?.capacity ?? 100;

  const download = () => {
    if (!zid) return;
    const blob = new Blob([toCsv(zid, rows)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `aera-${sid}-${zid}-occupancy.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <PageShell title="Analytics">
      {!sid ? <EmptyState title="No twin station available for your account" /> : (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-2">
            {stationIds.length > 1 && (
              <Select aria-label="Station" className="w-auto" value={sid} onChange={(e) => { setStation(e.target.value); setZone(null); }}>
                {stationIds.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            )}
            <Select aria-label="Zone" className="w-auto" value={zid ?? ""} onChange={(e) => setZone(e.target.value)}>
              {twin?.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </Select>
            <Select aria-label="Range" className="w-auto" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              <option value={60}>Last hour</option><option value={120}>Last 2 hours</option><option value={360}>Last 6 hours</option><option value={1440}>Last 24 hours</option>
            </Select>
            <Button onClick={download} disabled={!rows.length}>Export CSV</Button>
          </div>
          {error && <p role="alert" className="text-sm text-lvl-crowded">{error}</p>}
          <section className="panel p-4" aria-label="Occupancy over time">
            <h2 className="mb-3 text-lg font-bold text-ink">Occupancy over time</h2>
            <OccupancyChart rows={rows} capacity={capacity} thresholds={settings?.thresholds ?? { moderate: 40, busy: 60, crowded: 80 }} />
          </section>
          <section className="panel mt-4 p-4" aria-label="Alerts by type">
            <h2 className="mb-3 text-lg font-bold text-ink">Alerts by type, this session</h2>
            <table className="w-full text-left text-sm">
              <thead className="eyebrow"><tr><th className="py-1">Type</th><th>Raised</th><th>Resolved</th><th>Average time to resolve</th></tr></thead>
              <tbody className="divide-y divide-subtle">
                {Object.entries(summary).map(([type, s]) => (
                  <tr key={type}>
                    <td className="py-1.5 text-ink">{type.replace("_", " ")}</td>
                    <td className="tabular">{s.count}</td>
                    <td className="tabular">{s.resolved}</td>
                    <td className="tabular">{s.resolved ? `${Math.round(s.totalMs / s.resolved / 1000)} s` : "—"}</td>
                  </tr>
                ))}
                {!Object.keys(summary).length && <tr><td colSpan={4} className="py-2 text-muted">No alerts yet.</td></tr>}
              </tbody>
            </table>
          </section>
        </>
      )}
    </PageShell>
  );
}
