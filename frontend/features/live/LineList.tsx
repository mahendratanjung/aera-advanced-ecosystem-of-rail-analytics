"use client";

/**
 * The line as a list (NET-08, UX-06): every station with its next train each way, and every
 * train with its crowding. The same facts as the map in text, for screen readers, keyboards
 * and anyone who prefers a list. Opening a row selects it on the map.
 */

import { X } from "@phosphor-icons/react/dist/ssr";
import { useMemo, useState } from "react";
import { CrowdTag } from "@/components/Crowd";
import { Interchanges, StationCode } from "@/components/StationCode";
import { latest } from "@/lib/crowd/feed";
import type { CrowdEngine } from "@/lib/crowd/model";
import { useSimNow } from "@/lib/hooks";
import { NO_DISRUPTIONS, useTwin } from "@/lib/store";
import type { LineData } from "@/lib/types";
import { useUi } from "@/lib/ui";

type Next = { mins: number; load: number } | null;

export function LineList({ engine, line, onClose }: { engine: CrowdEngine; line: LineData; onClose: () => void }) {
  const [tab, setTab] = useState<"stations" | "trains">("stations");
  const now = useSimNow(15_000);
  const t = now / 1000;
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  const mult = useTwin((s) => s.sim?.scenario.demand_mult ?? 1);
  const selectStation = useUi((s) => s.selectStation);
  const selectTrain = useUi((s) => s.selectTrain);

  // Next train at every stop, one timetable pass per direction.
  const next = useMemo(() => {
    const out: Record<string, Record<number, Next>> = {};
    for (const d of line.directions) {
      const runs = engine.runs(d.direction_id, t - engine.lookback(t, disruptions), t + 2 * 3600, disruptions, mult);
      d.stops.forEach((s, k) => {
        out[s.station_id] ??= {};
        if (k === d.stops.length - 1) return void (out[s.station_id][d.direction_id] = null);
        const r = runs.filter((x) => x.times[k][1] >= t && Number.isFinite(x.times[k][0])).sort((a, b) => a.times[k][0] - b.times[k][0])[0];
        out[s.station_id][d.direction_id] = r ? { mins: Math.max(0, Math.round((r.times[k][0] - t) / 60)), load: r.legs[k] } : null;
      });
    }
    return out;
  }, [engine, line, t, disruptions, mult]);

  const names = useMemo(() => Object.fromEntries(line.stations.map((s) => [s.id, s.name])), [line]);
  const trains = [...latest.trains].sort((a, b) => b.loadPct - a.loadPct);
  const tabCls = (on: boolean) => `pressable flex-1 rounded-full px-3 py-1.5 text-[13px] font-semibold ${on ? "bg-white text-ink shadow-sm" : "text-ink-3"}`;

  return (
    <section aria-label="The line as a list">
      <header className="mb-3 flex items-center gap-2">
        <h2 className="flex-1 text-[17px] font-extrabold text-ink">Kelana Jaya Line</h2>
        <button type="button" onClick={onClose} aria-label="Close the list" className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-ink-2 hover:bg-surface-3">
          <X size={17} weight="bold" aria-hidden />
        </button>
      </header>
      <div role="tablist" aria-label="Show" className="mb-3 flex gap-1 rounded-full bg-surface-2 p-1">
        <button type="button" role="tab" aria-selected={tab === "stations"} onClick={() => setTab("stations")} className={tabCls(tab === "stations")}>Stations</button>
        <button type="button" role="tab" aria-selected={tab === "trains"} onClick={() => setTab("trains")} className={tabCls(tab === "trains")}>Trains ({trains.length})</button>
      </div>

      {tab === "stations" ? (
        <ol className="divide-y divide-rule">
          {line.stations.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => selectStation(s.id)} className="flex w-full items-start gap-3 py-2.5 text-left hover:bg-surface-2">
                <StationCode id={s.id} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[14px] font-bold text-ink">{s.name}</span>
                    <Interchanges id={s.id} />
                  </span>
                  {line.directions.map((d) => {
                    const n = next[s.id]?.[d.direction_id];
                    if (n === undefined || (n === null && d.stops[d.stops.length - 1].station_id === s.id)) return null;
                    return (
                      <span key={d.direction_id} className="mt-1 flex items-center justify-between gap-2 text-[12px]">
                        <span className="truncate text-ink-3">To {d.headsign}</span>
                        {n ? (
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="num font-semibold text-ink-2">{n.mins === 0 ? "Now" : `${n.mins} min`}</span>
                            <CrowdTag loadPct={n.load} size="sm" />
                          </span>
                        ) : <span className="text-ink-3">No train due</span>}
                      </span>
                    );
                  })}
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="divide-y divide-rule">
          {trains.length === 0 && <li className="py-4 text-[13px] text-ink-3">No trains are running now.</li>}
          {trains.map((tr) => {
            const d = line.directions.find((x) => x.direction_id === tr.state.directionId)!;
            const here = names[d.stops[tr.state.stopIndex]?.station_id] ?? "";
            const nxt = tr.state.nextIndex != null ? names[d.stops[tr.state.nextIndex]?.station_id] : null;
            const where = tr.state.status === "held" ? `Held at ${here}` : tr.state.status === "dwelling" ? `At ${here}` : `Next: ${nxt}`;
            return (
              <li key={tr.run.trip.id}>
                <button type="button" onClick={() => selectTrain(tr.run.trip.id)} className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold text-ink">To {d.headsign}</span>
                    <span className="block truncate text-[12px] text-ink-3">{where}</span>
                  </span>
                  <CrowdTag loadPct={tr.loadPct} size="sm" showPct />
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
