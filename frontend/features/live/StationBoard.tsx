"use client";

import { ArrowRight, Lightbulb, UsersThree } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CarDiagram, CrowdTag } from "@/components/Crowd";
import { ServiceNotices } from "@/components/Notice";
import { Interchanges, StationCode } from "@/components/StationCode";
import { HourBars } from "@/features/charts/HourBars";
import { TrainView } from "@/features/train3d/TrainView";
import { crowdOf, pctText } from "@/lib/crowd/levels";
import { type CrowdEngine, type Departure, hourOf, weekdayOf } from "@/lib/crowd/model";
import { klTime } from "@/lib/format";
import { useSimNow } from "@/lib/hooks";
import { NO_DISRUPTIONS, useTwin } from "@/lib/store";
import type { LineData } from "@/lib/types";

export function advice(deps: Departure[], t: number): string | null {
  if (!deps.length) return null;
  const first = deps[0];
  const lv = crowdOf(first.loadPct);
  if (lv.level >= 4) {
    const better = deps
      .slice(1)
      .filter((d) => d.arrival - first.arrival <= 12 * 60 && crowdOf(d.loadPct).level < lv.level && d.loadPct <= first.loadPct - 5)
      .sort((a, b) => a.loadPct - b.loadPct)[0];
    if (better) {
      const wait = Math.max(1, Math.round((better.arrival - t) / 60));
      return `Wait ${wait} min for the ${klTime(better.arrival * 1000)}. It should be ${crowdOf(better.loadPct).name.toLowerCase()} instead of ${lv.name.toLowerCase()}.`;
    }
    return lv.level === 5 ? "Trains are packed for a while. You may need to let one go." : "Expect crowded trains for the next 10 minutes or so.";
  }
  if (lv.level <= 2) return "The next train has room. Good time to travel.";
  return "Expect to stand on the next train.";
}

export function minutesText(d: Departure, t: number) {
  const mins = Math.max(0, Math.round((d.arrival - t) / 60));
  return d.arrival <= t || mins === 0 ? null : mins;
}

/** Which car has the most room, e.g. "Most room in car 4, at the back (Comfortable)". */
export function bestCar(cars: number[]): string | null {
  const levels = cars.map((c) => crowdOf(c).level);
  if (Math.max(...levels) === Math.min(...levels)) return null;
  const i = cars.indexOf(Math.min(...cars));
  const where = i === 0 ? ", at the front" : i === cars.length - 1 ? ", at the back" : "";
  return `Most room in car ${i + 1}${where} (${crowdOf(cars[i]).name})`;
}

function rangeText(d: Departure) {
  if (d.low >= 100) return "over capacity";
  if (d.high >= 100) return `${Math.floor(d.low)}% to over capacity`;
  return Math.round(d.high) - Math.round(d.low) >= 3 ? `${Math.floor(d.low)}–${Math.floor(d.high)}% full` : pctText(d.loadPct);
}

function DirectionBoard({ engine, line, stationId, dir, t, show3d }: { engine: CrowdEngine; line: LineData; stationId: string; dir: number; t: number; show3d: boolean }) {
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  const mult = useTwin((s) => s.sim?.scenario.demand_mult ?? 1);
  const head = line.directions.find((d) => d.direction_id === dir)!.headsign;
  const deps = useMemo(() => engine.departures(stationId, dir, t, disruptions, mult, 4), [engine, stationId, dir, t, disruptions, mult]);
  const lastDep = useMemo(() => {
    const k = engine.line.stopIndex[dir][stationId];
    if (k === undefined) return null;
    let last: number | null = null;
    for (const r of engine.runs(dir, t - 3600, t, disruptions, mult)) {
      const d = r.times[k][1];
      if (d <= t && (last === null || d > last)) last = d;
    }
    return last;
  }, [engine, stationId, dir, t, disruptions, mult]);
  if (engine.line.stopIndex[dir][stationId] === line.directions.find((d) => d.direction_id === dir)!.stops.length - 1) return null;
  const tip = advice(deps, t);
  const waiting = deps.length ? engine.waiting(stationId, dir, t, lastDep, mult) : 0;
  const first = deps[0];
  const firstMins = first ? minutesText(first, t) : null;

  return (
    <section aria-label={`Trains towards ${head}`} className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <h3 className="flex items-center gap-1.5 text-[15px] font-bold text-ink">
          <ArrowRight size={16} weight="bold" className="text-accent" aria-hidden /> To {head}
        </h3>
        {deps.length > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-2">
            <UsersThree size={14} aria-hidden /> ~<span className="num">{waiting}</span> waiting
          </span>
        )}
      </div>
      {!first ? (
        <p className="px-4 pb-4 pt-2 text-sm text-ink-2">No more trains today in this direction.</p>
      ) : (
        <>
          <div className="px-4 pt-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-ink-3">Next train</p>
                <p className="num text-[40px] font-extrabold leading-none tracking-tight text-ink" aria-label={firstMins === null ? "arriving now" : `in ${firstMins} minutes`}>
                  {firstMins === null ? "Now" : <>{firstMins}<span className="ml-1 text-lg font-bold text-ink-3">min</span></>}
                </p>
                <p className="mt-1 text-xs text-ink-3">
                  <span className="num">{klTime(first.arrival * 1000)}</span>
                  {first.delayS >= 60 && <span className="font-semibold text-critical"> · {Math.round(first.delayS / 60)} min late</span>}
                  <span> · {rangeText(first)}</span>
                </p>
              </div>
              <CrowdTag loadPct={first.loadPct} size="lg" />
            </div>
            <div className="mt-3">
              {show3d ? <TrainView cars={engine.carLoads(first.loadPct, dir)} height={150} /> : <CarDiagram cars={engine.carLoads(first.loadPct, dir)} size="lg" showPct />}
            </div>
            {!show3d && bestCar(engine.carLoads(first.loadPct, dir)) && (
              <p className="mt-2 text-xs font-semibold text-ink-2">Front of train first · {bestCar(engine.carLoads(first.loadPct, dir))}</p>
            )}
            {tip && (
              <p className="mt-3 flex gap-2 rounded-xl bg-accent-soft p-3 text-[13px] leading-snug text-[#1e3a8a]">
                <Lightbulb size={18} weight="fill" className="shrink-0 text-accent" aria-hidden />
                {tip}
              </p>
            )}
          </div>
          <ol className="mt-3 divide-y divide-rule border-t border-rule">
            {deps.slice(1).map((d) => {
              const mins = minutesText(d, t);
              return (
                <li key={d.run.trip.id} className="flex items-center gap-3 px-4 py-3">
                  <p className="num w-14 shrink-0 text-xl font-bold text-ink">{mins === null ? "Now" : <>{mins}<span className="ml-0.5 text-xs font-semibold text-ink-3">min</span></>}</p>
                  <div className="min-w-0 flex-1">
                    <CrowdTag loadPct={d.loadPct} size="sm" />
                    <p className="mt-0.5 text-xs text-ink-3">
                      <span className="num">{klTime(d.arrival * 1000)}</span>
                      {d.delayS >= 60 && <span className="font-semibold text-critical"> · {Math.round(d.delayS / 60)} min late</span>}
                    </p>
                  </div>
                  <CarDiagram cars={engine.carLoads(d.loadPct, dir)} size="sm" />
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}

export function StationBoard({ engine, line, stationId, headingLevel = 2, show3d = true, hideHeader = false }: {
  engine: CrowdEngine; line: LineData; stationId: string; headingLevel?: 1 | 2; show3d?: boolean; hideHeader?: boolean;
}) {
  const now = useSimNow(1000);
  const t = now / 1000;
  const st = line.stations.find((s) => s.id === stationId);
  const [chartDir, setChartDir] = useState(0);
  if (!st) return null;
  const H = headingLevel === 1 ? "h1" : "h2";
  const isEnd = (d: number) => engine.line.stopIndex[d][stationId] === line.directions.find((x) => x.direction_id === d)!.stops.length - 1;
  const dirForChart = isEnd(chartDir) ? 1 - chartDir : chartDir;
  const kk = engine.line.stopIndex[dirForChart][stationId];
  const day = engine.typicalDay(dirForChart, engine.segment(dirForChart, kk), weekdayOf(t));
  const heads = Object.fromEntries(line.directions.map((d) => [d.direction_id, d.headsign]));

  return (
    <article aria-label={`${st.name} departures`} className="space-y-4">
      {!hideHeader && <header className="flex items-center gap-3">
        <StationCode id={st.id} size="lg" />
        <div className="min-w-0">
          <H className="truncate text-2xl font-extrabold tracking-tight text-ink sm:text-[28px]">{st.name}</H>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
            <span>Kelana Jaya Line</span>
            <Interchanges id={st.id} />
          </div>
        </div>
      </header>}
      <ServiceNotices />
      {line.directions.map((d) => <DirectionBoard key={d.direction_id} engine={engine} line={line} stationId={stationId} dir={d.direction_id} t={t} show3d={show3d} />)}
      <section className="card p-4" aria-label="Typical crowding through the day">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[15px] font-bold text-ink">Through the day</h3>
          <div role="group" aria-label="Direction" className="flex rounded-full bg-surface-2 p-1 text-xs">
            {[0, 1].map((d) => (
              <button key={d} type="button" aria-pressed={dirForChart === d} onClick={() => setChartDir(d)} disabled={isEnd(d)}
                className={`pressable rounded-full px-3 py-1.5 font-semibold disabled:opacity-40 ${dirForChart === d ? "bg-white text-ink shadow-sm" : "text-ink-3"}`}>
                To {heads[d]}
              </button>
            ))}
          </div>
        </div>
        <p className="mb-3 text-xs text-ink-3">How full trains leaving {st.name} usually are on a {new Date(now).toLocaleDateString("en-GB", { weekday: "long", timeZone: "Asia/Kuala_Lumpur" })}.</p>
        <HourBars values={day} nowHour={hourOf(t)} label={`Typical load of trains leaving ${st.name} towards ${heads[dirForChart]} by hour`} />
      </section>
      <Link href={`/trip?from=${st.id}`} className="pressable flex items-center justify-between rounded-card bg-surface-2 px-4 py-3.5 text-sm font-semibold text-ink hover:bg-surface-3">
        Plan a ride from {st.name}
        <ArrowRight size={18} className="text-accent" aria-hidden />
      </Link>
    </article>
  );
}
