"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertItem } from "@/components/AlertItem";
import { SourceBadge } from "@/components/Badges";
import { BottomSheet } from "@/components/BottomSheet";
import { ClockChip } from "@/components/ClockChip";
import { CongestionPill } from "@/components/Congestion";
import { IconBack } from "@/components/Icons";
import { NextTrainRow } from "@/components/NextTrainRow";
import { EmptyState, Skeleton } from "@/components/States";
import { useLine, useMediaQuery, useSimNow, useStationDefinition } from "@/lib/hooks";
import { NO_DISRUPTIONS, useTwin } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { StationTwin } from "./StationTwin";
import { ZoneCard, ZoneTable } from "./ZonePanels";

function PassengerPanel({ id, selectedZone, onSelectZone }: { id: string; selectedZone: string | null; onSelectZone: (z: string | null) => void }) {
  const { line, model } = useLine("KJ");
  const { def } = useStationDefinition(line?.twin_stations.includes(id) ? id : null);
  const now = useSimNow(1000);
  const summary = useTwin((s) => s.stations[id]);
  const twin = useTwin((s) => s.twins[id]);
  const alerts = useTwin((s) => s.alerts);
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  const next = useMemo(() => (model ? model.nextDepartures(id, now / 1000, disruptions, 3) : null), [model, id, now, disruptions]);
  const station = line?.stations.find((s) => s.id === id);
  const stationAlerts = Object.values(alerts).filter((a) => a.state !== "resolved" && (a.station_id === id || a.type === "disruption") && (a.message || a.public_message));
  const zone = twin?.zones.find((z) => z.id === selectedZone);
  const platforms = twin?.zones.filter((z) => z.type === "platform") ?? [];
  const env = twin?.environment ?? {};

  if (!line) return <div className="space-y-3"><Skeleton className="h-8 w-40" /><Skeleton className="h-32" /></div>;
  if (!station) return <EmptyState title="Unknown station" body={`${id} is not on this line.`} />;

  return (
    <div className="space-y-5">
      <header>
        <Link href="/" className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-ink">
          <IconBack className="h-4 w-4" /> Back to the line
        </Link>
        <p className="eyebrow">{id} · {line.short_name}</p>
        <h1 className="text-3xl font-bold tracking-tight text-ink">{station.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {summary ? <CongestionPill level={summary.level} percent={summary.percent} /> : <Skeleton className="h-7 w-28" />}
          {summary && <SourceBadge source={summary.source} />}
        </div>
      </header>

      {stationAlerts.length > 0 && (
        <section aria-label="Alerts for this station">
          <ul className="space-y-2">
            {stationAlerts.map((a) => (
              <AlertItem key={a.id} alert={{ ...a, title: undefined, message: a.public_message ?? a.message }} compact={false}
                onSelect={a.zone_id ? () => onSelectZone(a.zone_id) : undefined} />
            ))}
          </ul>
        </section>
      )}

      {platforms.length > 0 && (
        <section aria-label="Platforms">
          <p className="eyebrow mb-2">Platforms now</p>
          <ul className="grid grid-cols-2 gap-2">
            {platforms.map((p) => {
              const dirId = def?.zones.find((z) => z.id === p.id)?.direction_id;
              const dir = line.directions.find((d) => d.direction_id === dirId);
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => onSelectZone(p.id)} className="w-full rounded-panel border border-subtle bg-raised p-3 text-left hover:border-cyan/60">
                    <p className="font-semibold text-ink">{p.name}</p>
                    {dir && <p className="text-xs text-muted">To {dir.headsign}</p>}
                    <CongestionPill level={p.level} estimated={p.estimated} size="sm" className="mt-2" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {zone && twin && <ZoneCard zone={zone} twin={twin} />}

      {line.directions.map((d) => (
        <section key={d.direction_id} aria-label={`Trains towards ${d.headsign}`}>
          <div className="flex items-center justify-between">
            <p className="eyebrow">Towards {d.headsign}</p>
            <SourceBadge source="sim" />
          </div>
          <ul className="divide-y divide-subtle">
            {next ? (next[d.direction_id] ?? []).map((dep) => <NextTrainRow key={dep.tripId} dep={dep} nowMs={now} />) : <Skeleton className="h-16" />}
            {next && !(next[d.direction_id] ?? []).length && <li className="py-2 text-sm text-muted">No more trains today.</li>}
          </ul>
        </section>
      ))}

      {twin && <ZoneTable twin={twin} onSelect={onSelectZone} selected={selectedZone} publicOnly />}

      {(env.temperature_c || env.humidity_pct) && (
        <section aria-label="Station conditions" className="flex items-center gap-4 text-sm">
          <p className="eyebrow">Conditions</p>
          {env.temperature_c && <span className="tabular text-ink">{env.temperature_c.value.toFixed(1)}°C</span>}
          {env.humidity_pct && <span className="tabular text-ink">{Math.round(env.humidity_pct.value)}% RH</span>}
          <SourceBadge source={env.temperature_c?.source ?? "sim"} />
        </section>
      )}

      {!line.twin_stations.includes(id) && (
        <EmptyState title="No 3D twin for this station yet" body="Busyness here is simulated. Taman Jaya is the station connected to our scale model." />
      )}
    </div>
  );
}

export function StationView({ id }: { id: string }) {
  const desktop = useMediaQuery("(min-width: 768px)");
  const { line } = useLine("KJ");
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [dive] = useState(() => useUi.getState().diving === id);
  const hasTwin = line?.twin_stations.includes(id) ?? false;

  const panel = <PassengerPanel id={id} selectedZone={selectedZone} onSelectZone={setSelectedZone} />;
  return (
    <>
      {hasTwin && (
        <div className={`fixed inset-0 z-10 pt-12 md:left-[72px] md:right-[404px] md:pt-0 ${desktop ? "" : "bottom-[28dvh]"} fade-in`}>
          <StationTwin stationId={id} selectedZone={selectedZone} onSelectZone={setSelectedZone} dive={dive} />
        </div>
      )}
      {desktop ? (
        <aside aria-label="Station details" className="theme-auto panel fixed bottom-4 right-4 top-4 z-30 w-[380px] overflow-y-auto p-5">{panel}</aside>
      ) : (
        <BottomSheet label="Station details" initial={hasTwin ? "peek" : "half"}>{panel}</BottomSheet>
      )}
      {desktop && <ClockChip className="fixed bottom-4 left-[88px] z-20" />}
    </>
  );
}
