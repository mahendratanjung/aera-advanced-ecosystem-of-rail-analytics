"use client";

import { ArrowsClockwise, Crosshair, VideoCamera, X } from "@phosphor-icons/react/dist/ssr";
import { type ReactNode, useEffect, useState } from "react";
import { CrowdMeter, CrowdTag } from "@/components/Crowd";
import { TrainView } from "@/features/train3d/TrainView";
import { crowdOf, pctText } from "@/lib/crowd/levels";
import { type LiveTrain, latest, subscribe } from "@/lib/crowd/feed";
import type { CrowdEngine } from "@/lib/crowd/model";
import { klTime } from "@/lib/format";
import { useReducedMotion } from "@/lib/hooks";
import type { LineData } from "@/lib/types";
import { type Cam, useUi } from "@/lib/ui";
import { ShareButton } from "./StationCard";
import { bestCar } from "./StationBoard";

/** Camera viewpoints for the selected train, as in Mini Tokyo 3D's tracking mode. */
function CameraModes() {
  const cam = useUi((s) => s.cam);
  const setCam = useUi((s) => s.setCam);
  const reduced = useReducedMotion();
  const modes: { id: Cam; label: string; icon: ReactNode }[] = [
    { id: "follow", label: "Follow", icon: <Crosshair size={16} weight="bold" aria-hidden /> },
    { id: "chase", label: "Chase", icon: <VideoCamera size={16} weight="bold" aria-hidden /> },
    ...(reduced ? [] : [{ id: "orbit" as const, label: "Orbit", icon: <ArrowsClockwise size={16} weight="bold" aria-hidden /> }]),
  ];
  return (
    <div role="group" aria-label="Camera" className="flex rounded-full bg-surface-2 p-1">
      {modes.map((m) => (
        <button key={m.id} type="button" aria-pressed={cam === m.id} onClick={() => setCam(cam === m.id ? "free" : m.id)}
          className={`pressable flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold ${cam === m.id ? "bg-accent text-accent-ink shadow-sm" : "text-ink-2"}`}>
          {m.icon}{m.label}
        </button>
      ))}
    </div>
  );
}

/** One train: how full it is now, car by car, and how that changes over the next stops. */
export function TrainDetail({ engine, line, tripId, onClose }: { engine: CrowdEngine; line: LineData; tripId: string; onClose: () => void }) {
  const [tr, setTr] = useState<LiveTrain | null>(() => latest.trains.find((x) => x.run.trip.id === tripId) ?? null);
  useEffect(() => {
    let last = 0;
    return subscribe((f) => {
      if (performance.now() - last < 1000) return;
      last = performance.now();
      setTr(f.trains.find((x) => x.run.trip.id === tripId) ?? null);
    });
  }, [tripId]);

  if (!tr) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-ink-2">This train has finished its trip.</p>
        <button type="button" onClick={onClose} className="text-sm font-semibold text-accent">Back to the line</button>
      </div>
    );
  }
  const dir = tr.run.trip.directionId;
  const d = line.directions.find((x) => x.direction_id === dir)!;
  const names = Object.fromEntries(line.stations.map((s) => [s.id, s.name]));
  const k = tr.state.stopIndex;
  const at = names[d.stops[k].station_id];
  const ahead = d.stops.slice(k + 1, k + 9).map((s, i) => ({ id: s.station_id, load: tr.run.legs[k + i] ?? 0, arr: tr.run.times[k + 1 + i][0] }));
  const [lo, hi] = engine.band(tr.run.times[k][1]);
  const people = Math.round((tr.loadPct / 100) * engine.capacity);

  return (
    <article aria-label="Selected train" className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-accent">Train to</p>
          <h2 className="text-[28px] font-extrabold leading-tight tracking-tight text-ink">{d.headsign}</h2>
          <p className="mt-0.5 text-[13px] text-ink-2">
            {tr.state.status === "held" ? <span className="font-semibold text-critical">Held at {at}</span> : tr.state.status === "dwelling" ? `At ${at}` : `Just left ${at}`}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <ShareButton params={`train=${encodeURIComponent(tripId)}`} title={`Train to ${d.headsign}`} />
          <button type="button" onClick={onClose} aria-label="Close train details" className="pressable flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-ink-2 hover:bg-surface-3">
            <X size={17} weight="bold" aria-hidden />
          </button>
        </div>
      </div>
      <CameraModes />
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CrowdTag loadPct={tr.loadPct} size="lg" showHint />
        </div>
        <p className="num mt-2 text-xs text-ink-3">
          {tr.loadPct >= 100
            ? `Over capacity: about ${people - engine.capacity} more people want this train than fit`
            : `${pctText(tr.loadPct)}, likely ${Math.floor(tr.loadPct * lo)}–${Math.min(100, Math.floor(tr.loadPct * hi))}% · about ${people} people on board`}
        </p>
        <div className="mt-4"><TrainView cars={engine.carLoads(tr.loadPct, dir)} height={170} /></div>
        {bestCar(engine.carLoads(tr.loadPct, dir)) && <p className="mt-2 text-xs font-semibold text-ink-2">{bestCar(engine.carLoads(tr.loadPct, dir))}</p>}
        <p className="mt-1 text-[11px] text-ink-3">Per-car shares are modelled: middle cars usually fill first.</p>
      </div>
      <section className="card overflow-hidden" aria-label="Crowding at the next stops">
        <h3 className="px-4 pb-2 pt-4 text-[15px] font-bold text-ink">Next stops</h3>
        <ol>
          {ahead.map((a, i) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
              <span className="relative flex w-3 justify-center self-stretch" aria-hidden>
                <span className="absolute inset-y-0 w-[3px] rounded-full bg-line/25" style={{ top: i === 0 ? "50%" : 0 }} />
                <span className="relative mt-[7px] h-2.5 w-2.5 rounded-full border-2 border-line bg-white" />
              </span>
              <span className="num w-11 shrink-0 text-ink-3">{Number.isFinite(a.arr) ? klTime(a.arr * 1000) : "—"}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-ink">{names[a.id]}</span>
              <span className="flex items-center gap-2 text-ink-2"><CrowdMeter level={crowdOf(a.load).level} size="sm" /><span className="w-[86px] text-xs font-semibold">{crowdOf(a.load).name}</span></span>
            </li>
          ))}
        </ol>
        <p className="px-4 pb-4 pt-1 text-[11px] text-ink-3">Load shown is for the ride leaving the previous stop.</p>
      </section>
    </article>
  );
}
