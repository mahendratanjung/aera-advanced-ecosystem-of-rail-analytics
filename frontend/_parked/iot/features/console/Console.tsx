"use client";

/**
 * Operator console (OPS-01 to OPS-05): twin, live alert queue, zone statistics and device
 * status on one screen, scoped to the operator's station.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertItem } from "@/components/AlertItem";
import { AppNav } from "@/components/AppNav";
import { SourceBadge } from "@/components/Badges";
import { Button } from "@/components/Button";
import { CongestionPill } from "@/components/Congestion";
import { DeviceRow } from "@/components/DeviceRow";
import { Input, Label, Select, Textarea } from "@/components/Field";
import { EmptyState } from "@/components/States";
import { ClockChip } from "@/components/ClockChip";
import { StationTwin } from "@/features/station-twin/StationTwin";
import { ZoneCard } from "@/features/station-twin/ZonePanels";
import { api } from "@/lib/api";
import { klTime } from "@/lib/format";
import { useRequireRole } from "@/lib/guard";
import { useLine } from "@/lib/hooks";
import { NO_LINKS, useTwin } from "@/lib/store";
import type { Alert, Incident } from "@/lib/types";

type TimelineItem = { kind: "alert" | "alert_resolved" | "incident" | "action"; ts_ms: number; data: any };

function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  return { run, error, busy };
}

function AlertQueue({ stationId, onFocus }: { stationId: string; onFocus: (zone: string | null) => void }) {
  const alerts = useTwin((s) => s.alerts);
  const { run, error } = useAction();
  const list = Object.values(alerts)
    .filter((a) => a.station_id === stationId && a.title)
    .sort((a, b) => Number(a.state === "resolved") - Number(b.state === "resolved") || b.started_at_ms - a.started_at_ms)
    .slice(0, 30);
  const open = list.filter((a) => a.state !== "resolved");
  return (
    <section aria-label="Alert queue" className="panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-bold text-ink">Alerts</h2>
        <span className="tabular text-sm text-muted">{open.length} open</span>
      </div>
      {error && <p role="alert" className="mb-2 text-sm text-lvl-crowded">{error}</p>}
      {list.length === 0 ? (
        <EmptyState title="No alerts" body="Crowding, disruptions, closures and device faults appear here as they happen." />
      ) : (
        <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1" aria-live="polite">
          {list.map((a: Alert) => (
            <AlertItem
              key={a.id}
              alert={a}
              onSelect={() => onFocus(a.zone_id)}
              actions={a.state !== "resolved" && (
                <>
                  {a.state === "active" && <Button size="sm" onClick={() => run(() => api(`/alerts/${a.id}/ack`, { method: "POST" }))}>Acknowledge</Button>}
                  <Button size="sm" variant="ghost" onClick={() => run(() => api(`/alerts/${a.id}/resolve`, { method: "POST" }))}>Resolve</Button>
                </>
              )}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ZoneActions({ stationId, zoneId }: { stationId: string; zoneId: string }) {
  const zone = useTwin((s) => s.twins[stationId]?.zones.find((z) => z.id === zoneId));
  const [reason, setReason] = useState("");
  const [count, setCount] = useState("");
  const { run, error, busy } = useAction();
  if (!zone) return null;
  return (
    <div className="mt-3 space-y-3 border-t border-subtle pt-3">
      {zone.available ? (
        <div className="flex gap-2">
          <Input aria-label="Reason for closing" placeholder="Reason, e.g. cleaning" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button variant="danger" disabled={busy}
            onClick={() => run(() => api(`/stations/${stationId}/zones/${zoneId}/availability`, { method: "POST", json: { available: false, reason: reason || null } }))}>
            Close
          </Button>
        </div>
      ) : (
        <Button disabled={busy} onClick={() => run(() => api(`/stations/${stationId}/zones/${zoneId}/availability`, { method: "POST", json: { available: true } }))}>
          Reopen {zone.name}
        </Button>
      )}
      <form className="flex gap-2" onSubmit={(e) => {
        e.preventDefault();
        const n = Number(count);
        if (Number.isFinite(n) && n >= 0) run(() => api(`/stations/${stationId}/zones/${zoneId}/recalibrate`, { method: "POST", json: { count: Math.round(n) } })).then(() => setCount(""));
      }}>
        <Input aria-label="Actual head count" type="number" min={0} placeholder="Actual count" value={count} onChange={(e) => setCount(e.target.value)} />
        <Button type="submit" disabled={busy || count === ""}>Recalibrate</Button>
      </form>
      {error && <p role="alert" className="text-sm text-lvl-crowded">{error}</p>}
    </div>
  );
}

function LinksPanel({ stationId }: { stationId: string }) {
  const links = useTwin((s) => s.twins[stationId]?.links ?? NO_LINKS);
  const { run, error } = useAction();
  return (
    <section aria-label="Entrances and connections" className="panel p-4">
      <h2 className="mb-2 text-lg font-bold text-ink">Entrances and connections</h2>
      <ul className="divide-y divide-subtle text-sm">
        {links.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-2 py-2">
            <div>
              <p className={l.available ? "text-ink" : "text-lvl-crowded"}>{l.name}{!l.available && " · closed"}</p>
              <p className="tabular text-xs text-muted">in {l.flow_in_per_min}/min · out {l.flow_out_per_min}/min</p>
            </div>
            <Button size="sm" variant={l.available ? "danger" : "outline"}
              onClick={() => run(() => api(`/stations/${stationId}/links/${l.id}/availability`, { method: "POST", json: { available: !l.available, reason: l.available ? "Closed by operator" : null } }))}>
              {l.available ? "Mark closed" : "Restore"}
            </Button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-sm text-lvl-crowded">{error}</p>}
    </section>
  );
}

function IncidentForm({ stationId, zones, alerts }: { stationId: string; zones: { id: string; name: string }[]; alerts: Alert[] }) {
  const [type, setType] = useState("crowding");
  const [zone, setZone] = useState("");
  const [alertId, setAlertId] = useState("");
  const [description, setDescription] = useState("");
  const [done, setDone] = useState(false);
  const { run, error, busy } = useAction();
  return (
    <section aria-label="Log an incident" className="panel p-4">
      <h2 className="mb-3 text-lg font-bold text-ink">Log an incident</h2>
      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          await api("/incidents", { method: "POST", json: { station_id: stationId, type, zone_id: zone || null, alert_id: alertId || null, description } });
          setDescription("");
          setDone(true);
          setTimeout(() => setDone(false), 2500);
        });
      }}>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="inc-type">Type</Label>
            <Select id="inc-type" value={type} onChange={(e) => setType(e.target.value)}>
              {["crowding", "equipment", "safety", "medical", "security", "service", "other"].map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="inc-zone">Zone</Label>
            <Select id="inc-zone" value={zone} onChange={(e) => setZone(e.target.value)}>
              <option value="">Whole station</option>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="inc-alert">Linked alert</Label>
          <Select id="inc-alert" value={alertId} onChange={(e) => setAlertId(e.target.value)}>
            <option value="">None</option>
            {alerts.map((a) => <option key={a.id} value={a.id}>{a.title} · {klTime(a.started_at_ms)}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="inc-desc">What happened</Label>
          <Textarea id="inc-desc" rows={3} required value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {error && <p role="alert" className="text-sm text-lvl-crowded">{error}</p>}
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={busy || !description.trim()}>Log incident</Button>
          {done && <p role="status" className="text-sm text-lvl-low">Logged. Admins can see it now.</p>}
        </div>
      </form>
    </section>
  );
}

function Timeline({ stationId }: { stationId: string }) {
  const [items, setItems] = useState<TimelineItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alerts = useTwin((s) => s.alerts);
  const incidents = useTwin((s) => s.incidents);
  const audit = useTwin((s) => s.audit);
  useEffect(() => {
    let alive = true;
    const id = setTimeout(() => {
      api<TimelineItem[]>(`/stations/${stationId}/timeline`)
        .then((d) => alive && setItems(d))
        .catch((e) => alive && setError(e.message));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [stationId, alerts, incidents, audit]);
  const text = (it: TimelineItem) => {
    if (it.kind === "alert") return `Alert raised: ${it.data.title}`;
    if (it.kind === "alert_resolved") return `Alert resolved by ${it.data.resolved_by}: ${it.data.title}`;
    if (it.kind === "incident") return `Incident (${it.data.type}) by ${it.data.created_by}: ${it.data.description}`;
    return `${it.data.actor} · ${it.data.action.replace(".", " ")} · ${it.data.target}`;
  };
  return (
    <section aria-label="Timeline" className="panel p-4">
      <h2 className="mb-2 text-lg font-bold text-ink">Timeline</h2>
      {error && <p className="text-sm text-lvl-crowded">{error}</p>}
      {!items ? <p className="text-sm text-muted">Loading…</p> : items.length === 0 ? <p className="text-sm text-muted">Nothing yet today.</p> : (
        <ol className="max-h-[320px] space-y-1.5 overflow-y-auto text-sm">
          {items.slice(0, 80).map((it, i) => (
            <li key={i} className="flex gap-3">
              <span className="tabular shrink-0 text-faint">{klTime(it.ts_ms, true)}</span>
              <span className={it.kind === "incident" ? "text-ink" : "text-muted"}>{text(it)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ModelLink({ stationId }: { stationId: string }) {
  const cmd = useTwin((s) => s.commands[stationId]);
  if (!cmd) return null;
  return (
    <section aria-label="Commands to the scale model" className="panel p-4">
      <h2 className="mb-1 text-lg font-bold text-ink">Scale model link</h2>
      <p className="mb-2 text-xs text-muted">Last command sent to the model at {klTime(cmd.sent_ms, true)}. LEDs mirror zone levels.</p>
      <div className="flex flex-wrap gap-1.5">
        {cmd.leds.map((l) => (
          <span key={l.zone} className="flex items-center gap-1 rounded bg-sunken px-2 py-1 text-xs text-ink">
            <span aria-hidden className={`h-2 w-2 rounded-full ${l.level === "nodata" || l.level === "off" ? "bg-lvl-nodata" : `bg-lvl-${l.level}`}`} />
            {l.zone} · {l.level}
          </span>
        ))}
      </div>
      {cmd.display && (
        <div className="tabular mt-3 inline-block rounded bg-black px-3 py-2 text-xs leading-5 text-cyan">
          <div>{cmd.display.line1}</div>
          <div>{cmd.display.line2}</div>
        </div>
      )}
    </section>
  );
}

export function Console() {
  const { user, allowed, ready } = useRequireRole("operator");
  const { line } = useLine("KJ");
  const twins = useTwin((s) => s.twins);
  const devices = useTwin((s) => s.devices);
  const alerts = useTwin((s) => s.alerts);
  const summary = useTwin((s) => s.stations);
  const [adminStation, setAdminStation] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [wall, setWall] = useState(false);

  const stationId = user?.role === "admin" ? adminStation ?? line?.twin_stations[0] ?? null : user?.station_id ?? null;
  const twin = stationId ? twins[stationId] : undefined;
  const station = line?.stations.find((s) => s.id === stationId);
  const openAlerts = useMemo(() => Object.values(alerts).filter((a) => a.station_id === stationId && a.state !== "resolved" && a.title), [alerts, stationId]);
  const zone = twin?.zones.find((z) => z.id === selectedZone);

  useEffect(() => {
    const onChange = () => setWall(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  if (!ready || !user) return <div className="p-8 text-muted">Checking your session…</div>;
  if (!allowed) return <div className="p-8 text-muted">Your account cannot open the console.</div>;

  const toggleWall = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}));

  return (
    <div className="page-scroll">
      {!wall && <AppNav />}
      <main className={`px-3 pb-10 ${wall ? "pt-3" : "pt-14 md:pl-[88px] md:pt-4"} md:pr-4`}>
        <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Operator console · {user.display_name}</p>
            <h1 className="text-2xl font-bold text-ink">{station?.name ?? stationId ?? "No station assigned"}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {user.role === "admin" && line && (
              <Select aria-label="Station" value={stationId ?? ""} onChange={(e) => setAdminStation(e.target.value)} className="w-auto">
                {line.stations.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.name}</option>)}
              </Select>
            )}
            {stationId && summary[stationId] && <CongestionPill level={summary[stationId].level} percent={summary[stationId].percent} />}
            {twin && <SourceBadge source={twin.source_mode} />}
            <ClockChip />
            <Button onClick={toggleWall}>{wall ? "Exit wall mode" : "Wall mode"}</Button>
          </div>
        </header>

        {!stationId ? (
          <EmptyState title="No station assigned" body="Ask an admin to assign you to a station." />
        ) : (
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="space-y-3">
              {twin ? (
                <div className={`panel relative overflow-hidden ${wall ? "h-[72vh]" : "h-[56vh] min-h-[380px]"}`}>
                  <StationTwin stationId={stationId} selectedZone={selectedZone} onSelectZone={setSelectedZone} compactToolbar />
                </div>
              ) : (
                <EmptyState title="This station has no sensor twin" body="Alerts, incidents and simulated busyness are still available for your station." />
              )}
              {twin && (
                <section aria-label="Zone statistics" className="panel p-4">
                  <h2 className="mb-2 text-lg font-bold text-ink">Zones</h2>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {twin.zones.map((z) => (
                      <button key={z.id} type="button" onClick={() => setSelectedZone(z.id)}
                        className={`rounded-panel border p-3 text-left ${selectedZone === z.id ? "border-cyan" : "border-subtle hover:border-strong-line"} ${!z.available ? "hatch" : "bg-raised"}`}>
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-ink">{z.name}</span>
                          <span className="tabular text-sm text-muted">{z.count}/{z.capacity}</span>
                        </div>
                        <CongestionPill level={z.level} estimated={z.estimated} percent={z.percent} size="sm" className="mt-2" />
                      </button>
                    ))}
                  </div>
                  {zone && (
                    <div className="mt-3">
                      <ZoneCard zone={zone} twin={twin}><ZoneActions stationId={stationId} zoneId={zone.id} /></ZoneCard>
                    </div>
                  )}
                </section>
              )}
              <div className="grid gap-3 lg:grid-cols-2">
                <Timeline stationId={stationId} />
                <IncidentForm stationId={stationId} zones={twin?.zones ?? []} alerts={openAlerts} />
              </div>
            </div>
            <div className="space-y-3">
              <AlertQueue stationId={stationId} onFocus={(z) => z && setSelectedZone(z)} />
              {twin && <LinksPanel stationId={stationId} />}
              <section aria-label="Devices" className="panel p-4">
                <h2 className="mb-1 text-lg font-bold text-ink">Devices</h2>
                <ul className="divide-y divide-subtle">
                  {Object.values(devices).filter((d) => d.station_id === stationId && !d.retired).map((d) => <DeviceRow key={d.id} device={d} />)}
                </ul>
              </section>
              <ModelLink stationId={stationId} />
              <IncidentList stationId={stationId} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function IncidentList({ stationId }: { stationId: string }) {
  const incidents = useTwin((s) => s.incidents).filter((i: Incident) => i.station_id === stationId);
  if (!incidents.length) return null;
  return (
    <section aria-label="Incident log" className="panel p-4">
      <h2 className="mb-2 text-lg font-bold text-ink">Incident log</h2>
      <ul className="space-y-2 text-sm">
        {incidents.slice(0, 10).map((i) => (
          <li key={i.id} className="rounded bg-raised p-2">
            <p className="text-xs text-faint">{klTime(i.created_at_ms)} · {i.type}{i.zone_id && ` · ${i.zone_id}`} · {i.created_by}</p>
            <p className="text-ink">{i.description}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
