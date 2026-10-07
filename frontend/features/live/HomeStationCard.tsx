"use client";

/**
 * "My station" (CARD-01): shown when nothing is selected, so the rider's answer is on screen
 * from the first load. Next train each way with its crowding and cars; opens the full card.
 */

import { CaretDown, CaretRight } from "@phosphor-icons/react/dist/ssr";
import { useEffect, useMemo } from "react";
import { CarDiagram, CrowdTag } from "@/components/Crowd";
import type { CrowdEngine } from "@/lib/crowd/model";
import { useHome } from "@/lib/home";
import { useSimNow } from "@/lib/hooks";
import { NO_DISRUPTIONS, useTwin } from "@/lib/store";
import type { LineData } from "@/lib/types";
import { StationImage } from "./StationCard";

export function HomeStationCard({ engine, line, onOpen }: { engine: CrowdEngine; line: LineData; onOpen: (id: string) => void }) {
  const home = useHome((s) => s.id);
  const setHome = useHome((s) => s.set);
  const load = useHome((s) => s.load);
  useEffect(() => load(line.stations.map((s) => s.id)), [line, load]);
  const now = useSimNow(5000);
  const t = now / 1000;
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  const mult = useTwin((s) => s.sim?.scenario.demand_mult ?? 1);
  const next = useMemo(
    () => line.directions
      .filter((d) => engine.line.stopIndex[d.direction_id][home] !== d.stops.length - 1)
      .map((d) => ({ d, dep: engine.departures(home, d.direction_id, t, disruptions, mult, 1)[0] })),
    [engine, line, home, t, disruptions, mult],
  );
  const st = line.stations.find((s) => s.id === home)!;

  return (
    <section aria-label="My station">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => onOpen(home)} aria-label={`Open ${st.name}`} className="pressable shrink-0 overflow-hidden rounded-xl">
          <StationImage id={home} className="h-14 w-14" />
        </button>
        <div className="min-w-0 flex-1">
          <label htmlFor="home-station" className="block text-[11px] font-bold uppercase tracking-wide text-accent">My station</label>
          <div className="relative">
            <select id="home-station" value={home} onChange={(e) => setHome(e.target.value)}
              className="w-full cursor-pointer appearance-none truncate bg-transparent pr-6 text-[20px] font-extrabold tracking-tight text-ink focus:outline-none">
              {line.stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <CaretDown size={14} weight="bold" aria-hidden className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-ink-3" />
          </div>
        </div>
        <button type="button" onClick={() => onOpen(home)} className="pressable flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-3 py-2 text-[13px] font-bold text-accent">
          All trains<CaretRight size={14} weight="bold" aria-hidden />
        </button>
      </div>
      <ul className="mt-3 space-y-2">
        {next.map(({ d, dep }) => {
          const mins = dep ? Math.max(0, Math.round((dep.arrival - t) / 60)) : null;
          return (
            <li key={d.direction_id} className="flex items-center gap-3 rounded-2xl bg-surface-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-semibold text-ink-3">To {d.headsign}</p>
                {dep ? (
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="num text-[22px] font-extrabold leading-none text-ink">{mins === 0 ? "Now" : <>{mins}<span className="ml-0.5 text-[13px] font-bold text-ink-3">min</span></>}</span>
                    <CrowdTag loadPct={dep.loadPct} size="sm" />
                  </div>
                ) : (
                  <p className="text-[13px] text-ink-2">No more trains today</p>
                )}
              </div>
              {dep && <CarDiagram cars={engine.carLoads(dep.loadPct, d.direction_id)} size="md" />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
