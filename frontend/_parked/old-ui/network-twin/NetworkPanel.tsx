"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { AlertItem } from "@/components/AlertItem";
import { SourceBadge } from "@/components/Badges";
import { BottomSheet } from "@/components/BottomSheet";
import { Button } from "@/components/Button";
import { CongestionPill, LevelLegend } from "@/components/Congestion";
import { IconClose, IconTrain } from "@/components/Icons";
import { NextTrainRow } from "@/components/NextTrainRow";
import { Skeleton } from "@/components/States";
import { klTime, minutesUntil } from "@/lib/format";
import { useLine, useMediaQuery, useSimNow } from "@/lib/hooks";
import { NO_DISRUPTIONS, useTwin } from "@/lib/store";
import { useUi } from "@/lib/ui";
import type { LineData } from "@/lib/types";
import type { LineModel } from "@/lib/sim/trains";
import { liveTrains } from "./NetworkMap";

function PublicAlerts() {
  const alerts = useTwin((s) => s.alerts);
  const open = Object.values(alerts).filter((a) => a.state !== "resolved" && a.message).sort((a, b) => b.started_at_ms - a.started_at_ms);
  if (!open.length) return null;
  return (
    <section aria-label="Service alerts" className="mb-4">
      <p className="eyebrow mb-2">Service alerts</p>
      <ul className="space-y-2">{open.slice(0, 3).map((a) => <AlertItem key={a.id} alert={{ ...a, title: undefined }} />)}</ul>
    </section>
  );
}

function StationCard({ id, line, model }: { id: string; line: LineData; model: LineModel }) {
  const router = useRouter();
  const now = useSimNow(1000);
  const summary = useTwin((s) => s.stations[id]);
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  const select = useUi((s) => s.selectStation);
  const st = line.stations.find((s) => s.id === id)!;
  const next = useMemo(() => model.nextDepartures(id, now / 1000, disruptions, 2), [model, id, now, disruptions]);
  const twin = line.twin_stations.includes(id);
  return (
    <article aria-label={`${st.name} station`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="eyebrow">{id} · {line.short_name}</p>
          <h2 className="text-2xl font-bold text-ink">{st.name}</h2>
          {st.full_name !== st.name && <p className="text-xs text-faint">{st.full_name}</p>}
        </div>
        <button type="button" onClick={() => select(null)} aria-label="Close station card" className="rounded p-1 text-muted hover:text-ink">
          <IconClose className="h-5 w-5" />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {summary ? <CongestionPill level={summary.level} percent={summary.percent} /> : <Skeleton className="h-7 w-28" />}
        {summary && <SourceBadge source={summary.source} />}
      </div>
      {line.directions.map((d) => (
        <section key={d.direction_id} className="mt-4">
          <p className="eyebrow">Towards {d.headsign} · simulated</p>
          <ul className="divide-y divide-subtle">
            {(next[d.direction_id] ?? []).map((dep) => <NextTrainRow key={dep.tripId} dep={dep} nowMs={now} />)}
            {!(next[d.direction_id] ?? []).length && <li className="py-2 text-sm text-muted">No more trains today from this station.</li>}
          </ul>
        </section>
      ))}
      <div className="mt-4 flex gap-2">
        {twin ? (
          <Button variant="primary" onClick={() => { useUi.getState().setDiving(id); router.push(`/station/${id}`); }}>
            Enter station twin
          </Button>
        ) : (
          <Link href={`/station/${id}`} className="inline-flex items-center rounded-md border border-strong-line px-3.5 py-2 text-sm font-semibold text-ink hover:bg-raised">
            Station details
          </Link>
        )}
      </div>
    </article>
  );
}

function TrainCard({ tripId, line, model }: { tripId: string; line: LineData; model: LineModel }) {
  const now = useSimNow(1000);
  const follow = useUi((s) => s.followTrain);
  const setFollow = useUi((s) => s.setFollow);
  const selectTrain = useUi((s) => s.selectTrain);
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  const tr = liveTrains.list.find((t) => t.tripId === tripId);
  if (!tr) {
    return (
      <div>
        <p className="text-sm text-muted">This train has finished its journey.</p>
        <Button size="sm" className="mt-2" onClick={() => selectTrain(null)}>Close</Button>
      </div>
    );
  }
  const dir = line.directions.find((d) => d.direction_id === tr.directionId)!;
  const nextIdx = tr.status === "moving" ? tr.nextIndex : tr.stopIndex;
  const nextStop = nextIdx !== null ? dir.stops[nextIdx] : null;
  const station = nextStop ? line.stations.find((s) => s.id === nextStop.station_id) : null;
  const eta = nextStop ? model.nextDepartures(nextStop.station_id, now / 1000, disruptions, 6)[tr.directionId]?.find((d) => d.tripId === tripId) : null;
  return (
    <article aria-label="Selected train">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <IconTrain className="h-6 w-6 text-cyan" />
          <div>
            <p className="eyebrow">Simulated train</p>
            <h2 className="text-xl font-bold text-ink">To {dir.headsign}</h2>
          </div>
        </div>
        <button type="button" onClick={() => selectTrain(null)} aria-label="Close train card" className="rounded p-1 text-muted hover:text-ink">
          <IconClose className="h-5 w-5" />
        </button>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div><dt className="eyebrow">Status</dt><dd className="text-ink">{tr.status === "held" ? "Held at station" : tr.status === "dwelling" ? "At station" : "Running"}</dd></div>
        <div><dt className="eyebrow">{tr.status === "moving" ? "Next stop" : "At"}</dt><dd className="text-ink">{station?.name ?? "Terminus"}</dd></div>
        <div><dt className="eyebrow">Arrives</dt><dd className="tabular text-ink">{eta ? (eta.atPlatform ? "Now" : `${klTime(eta.arrival * 1000)} · ${minutesUntil(eta.arrival, now)} min`) : "—"}</dd></div>
        <div><dt className="eyebrow">Load</dt><dd className="tabular text-ink">{Math.round(tr.loadPct)}%</dd></div>
      </dl>
      <label className="mt-4 flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
        Follow this train
      </label>
    </article>
  );
}

function StationList({ line }: { line: LineData }) {
  const stations = useTwin((s) => s.stations);
  const select = useUi((s) => s.selectStation);
  return (
    <section aria-label="All stations">
      <p className="eyebrow mb-1">Stations · {line.stations.length}</p>
      <ol className="divide-y divide-subtle">
        {line.stations.map((s) => {
          const sum = stations[s.id];
          return (
            <li key={s.id}>
              <button type="button" onClick={() => select(s.id)} className="flex w-full items-center justify-between gap-2 py-2 text-left hover:bg-raised/60">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="tabular w-9 shrink-0 text-xs text-faint">{s.id}</span>
                  <span className="truncate text-sm text-ink">{s.name}</span>
                  {line.twin_stations.includes(s.id) && <span className="rounded bg-cyan/15 px-1 text-[9px] uppercase tracking-[0.14em] text-cyan">Twin</span>}
                </span>
                {sum ? <CongestionPill level={sum.level} size="sm" /> : <Skeleton className="h-5 w-16" />}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function PanelBody() {
  const { line, model } = useLine("KJ");
  const selectedStation = useUi((s) => s.selectedStation);
  const selectedTrain = useUi((s) => s.selectedTrain);
  const settings = useTwin((s) => s.settings);
  if (!line || !model) {
    return <div className="space-y-3 py-2"><Skeleton className="h-6 w-40" /><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>;
  }
  return (
    <div className="space-y-4">
      {selectedStation ? (
        <StationCard id={selectedStation} line={line} model={model} />
      ) : selectedTrain ? (
        <TrainCard tripId={selectedTrain} line={line} model={model} />
      ) : (
        <>
          <header>
            <div className="flex items-center gap-2">
              <span aria-hidden className="h-3 w-8 rounded-full" style={{ background: line.color ?? "var(--brand-cyan)" }} />
              <h2 className="text-xl font-bold text-ink">{line.name}</h2>
            </div>
            <p className="mt-1 text-sm text-muted">
              Trains follow the published timetable on a simulated clock. Taman Jaya is connected to sensors on our scale model.
            </p>
            <div className="mt-2 flex gap-2"><SourceBadge source="sim" /><span className="text-xs text-faint">Trains and other stations</span></div>
          </header>
          <PublicAlerts />
          <StationList line={line} />
        </>
      )}
      <div className="border-t border-subtle pt-3"><LevelLegend thresholds={settings?.thresholds} /></div>
    </div>
  );
}

export function NetworkPanel() {
  const desktop = useMediaQuery("(min-width: 768px)");
  const selected = useUi((s) => s.selectedStation || s.selectedTrain);
  if (!desktop) {
    return <BottomSheet label="Line details" initial={selected ? "half" : "peek"}><PanelBody /></BottomSheet>;
  }
  return (
    <aside aria-label="Line details" className="theme-auto panel fixed bottom-4 right-4 top-4 z-30 w-[380px] overflow-y-auto p-5">
      <PanelBody />
    </aside>
  );
}
