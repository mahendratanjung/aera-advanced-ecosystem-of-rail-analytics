"use client";

/**
 * Plan a ride by crowding: for a pair of stations, every train in the next hour with the
 * crowding on each stretch of the ride, and the calmest one to take.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowsDownUp, Clock, MapPin, Star } from "@phosphor-icons/react/dist/ssr";
import { Page, Section } from "@/components/Page";
import { CrowdTag } from "@/components/Crowd";
import { EmptyState, Skeleton } from "@/components/States";
import { HourBars } from "@/features/charts/HourBars";
import { crowdOf } from "@/lib/crowd/levels";
import { type CrowdEngine, type TripOption, hourOf, weekdayOf } from "@/lib/crowd/model";
import { klTime } from "@/lib/format";
import { useCrowd, useSimNow } from "@/lib/hooks";
import { NO_DISRUPTIONS, useTwin } from "@/lib/store";
import type { LineData } from "@/lib/types";

const WINDOW_S = 75 * 60;

function bestOf(options: TripOption[]): TripOption | null {
  if (!options.length) return null;
  const first = options[0];
  // Prefer a calmer ride only when it is a whole crowding level better and clearly emptier,
  // so a train one point under a threshold is never worth waiting for.
  const calmer = options.filter((o) => crowdOf(o.peak).level < crowdOf(first.peak).level && o.peak <= first.peak - 5);
  if (!calmer.length) return first;
  return calmer.reduce((a, b) => (crowdOf(b.peak).level < crowdOf(a.peak).level || (crowdOf(b.peak).level === crowdOf(a.peak).level && b.depart < a.depart) ? b : a));
}

function LegStrip({ o, line, dir, from }: { o: TripOption; line: LineData; dir: number; from: number }) {
  const stops = line.directions.find((d) => d.direction_id === dir)!.stops;
  const names = Object.fromEntries(line.stations.map((s) => [s.id, s.name]));
  return (
    <span className="flex gap-[2px]" role="img"
      aria-label={o.legLoads.map((l, i) => `${names[stops[from + i].station_id]} to ${names[stops[from + i + 1].station_id]} ${crowdOf(l).name}`).join(", ")}>
      {o.legLoads.map((l, i) => (
        <span key={i} title={`${names[stops[from + i].station_id]} → ${names[stops[from + i + 1].station_id]}: ${crowdOf(l).name}, ${Math.round(l)}%`}
          className="h-2.5 min-w-[6px] flex-1 rounded-full" style={{ background: `var(--crowd-${crowdOf(l).level})` }} />
      ))}
    </span>
  );
}

function typicalRide(engine: CrowdEngine, dir: number, ko: number, kd: number, weekday: number): (number | null)[] {
  const days = Array.from({ length: kd - ko }, (_, i) => engine.typicalDay(dir, engine.segment(dir, ko + i), weekday));
  return Array.from({ length: 24 }, (_, h) => {
    const vals = days.map((d) => d[h]).filter((v): v is number => v !== null);
    return vals.length ? Math.max(...vals) : null;
  });
}

export function TripPlanner() {
  const { line, engine, error } = useCrowd("KJ");
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const now = useSimNow(5000);
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  const mult = useTwin((s) => s.sim?.scenario.demand_mult ?? 1);
  const from = params.get("from") ?? "KJ20";
  const to = params.get("to") ?? "KJ15";
  const [later, setLater] = useState("");
  const [showAll, setShowAll] = useState(false);

  const setParam = (k: string, v: string) => {
    const q = new URLSearchParams(params.toString());
    q.set(k, v);
    router.replace(`${path}?${q.toString()}`, { scroll: false });
  };

  const t = useMemo(() => {
    const base = now / 1000;
    if (!later) return base;
    const [h, m] = later.split(":").map(Number);
    const dayStart = Math.floor((base + 8 * 3600) / 86400) * 86400 - 8 * 3600;
    const at = dayStart + h * 3600 + m * 60;
    return at < base - 600 ? at + 86400 : at;
  }, [now, later]);

  const result = useMemo(() => (engine ? engine.trip(from, to, t, disruptions, mult, WINDOW_S) : null), [engine, from, to, t, disruptions, mult]);
  const best = result ? bestOf(result.options) : null;
  const names = line ? Object.fromEntries(line.stations.map((s) => [s.id, s.name])) : {};

  const swap = () => {
    const q = new URLSearchParams(params.toString());
    q.set("from", to);
    q.set("to", from);
    router.replace(`${path}?${q}`, { scroll: false });
  };
  const sel = "w-full appearance-none bg-transparent py-1 text-[15px] font-semibold text-ink focus:outline-none";

  return (
    <Page title="Plan a ride" intro="Choose where you start and end. See how full every train will be on your part of the line, and which one is calmest.">
      {error && <EmptyState title="Predictions are unavailable" body={error} />}
      {!line || !engine ? <Skeleton className="h-48" /> : (
        <>
          <form className="card-raised relative p-2" onSubmit={(e) => e.preventDefault()}>
            <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-2">
              <span aria-hidden className="h-3 w-3 shrink-0 rounded-full border-[3px] border-accent" />
              <div className="min-w-0 flex-1">
                <label htmlFor="from" className="block text-[11px] font-semibold text-ink-3">From</label>
                <select id="from" value={from} onChange={(e) => setParam("from", e.target.value)} className={sel}>
                  {line.stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div className="ml-[22px] h-px bg-rule" />
            <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-2">
              <MapPin size={14} weight="fill" className="shrink-0 text-highlight" aria-hidden />
              <div className="min-w-0 flex-1">
                <label htmlFor="to" className="block text-[11px] font-semibold text-ink-3">To</label>
                <select id="to" value={to} onChange={(e) => setParam("to", e.target.value)} className={sel}>
                  {line.stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <button type="button" aria-label="Swap start and end" onClick={swap}
              className="pressable absolute right-4 top-[46px] flex h-10 w-10 items-center justify-center rounded-full border border-rule bg-white text-ink-2 shadow-sm hover:text-accent">
              <ArrowsDownUp size={18} weight="bold" aria-hidden />
            </button>
            <div className="mt-1 flex items-center gap-2 border-t border-rule px-3 pb-1 pt-3">
              <Clock size={16} className="text-ink-3" aria-hidden />
              <label htmlFor="when" className="text-[13px] font-semibold text-ink-2">Leave</label>
              <div role="group" aria-label="When" className="ml-auto flex items-center gap-1 rounded-full bg-surface-2 p-1">
                <button type="button" aria-pressed={!later} onClick={() => setLater("")}
                  className={`pressable rounded-full px-3 py-1 text-xs font-semibold ${!later ? "bg-white text-ink shadow-sm" : "text-ink-3"}`}>Now</button>
                <input id="when" type="time" value={later} onChange={(e) => setLater(e.target.value)} aria-label="Leave at a time"
                  className={`rounded-full px-2 py-1 text-xs font-semibold ${later ? "bg-white text-ink shadow-sm" : "bg-transparent text-ink-3"}`} />
              </div>
            </div>
          </form>

          {from === to ? (
            <div className="mt-6"><EmptyState title="Pick two different stations" /></div>
          ) : !result || result.options.length === 0 ? (
            <div className="mt-6"><EmptyState title="No trains in this window" body="Service runs from about 06:00 to 23:15. Try a later time." /></div>
          ) : (
            <>
              {best && (
                <section aria-label="Best train" className="mb-8 mt-5 overflow-hidden rounded-card border-2 border-highlight/40 bg-highlight-soft">
                  <div className="flex items-start justify-between gap-3 p-4">
                    <div>
                      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-highlight">
                        <Star size={14} weight="fill" aria-hidden /> Best train
                      </p>
                      <p className="num mt-1 text-[34px] font-extrabold leading-none text-ink">{klTime(best.depart * 1000)}</p>
                      <p className="mt-1.5 text-[13px] text-ink-2">
                        {best === result.options[0] ? "The next train" : `${Math.max(1, Math.round((best.depart - t) / 60))} min from now`}
                        {" · "}arrive {names[to]} <span className="num font-semibold text-ink">{klTime(best.arrive * 1000)}</span> · {best.minutes} min ride
                      </p>
                    </div>
                    <CrowdTag loadPct={best.peak} size="lg" />
                  </div>
                  <div className="border-t border-highlight/20 bg-white/60 px-4 py-3 text-[13px] text-ink-2">
                    At its busiest it should be <strong className="text-ink">{crowdOf(best.peak).name.toLowerCase()}</strong> ({crowdOf(best.peak).hint.toLowerCase()}).
                    {best !== result.options[0] && <> The next train will be {crowdOf(result.options[0].peak).name.toLowerCase()}.</>}
                  </div>
                </section>
              )}
              <Section title="Trains in the next hour" note={`${names[from]} to ${names[to]}, towards ${line.directions.find((d) => d.direction_id === result.dir)!.headsign}. Each bar is one stretch of your ride.`}>
                <ol className="card divide-y divide-rule overflow-hidden">
                  {(showAll ? result.options : result.options.slice(0, 8)).map((o) => {
                    const mins = Math.max(0, Math.round((o.depart - t) / 60));
                    return (
                      <li key={o.run.trip.id} className={`px-4 py-3.5 ${o === best ? "bg-highlight-soft/60" : ""}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-baseline gap-2.5">
                            <span className="num text-xl font-extrabold text-ink">{klTime(o.depart * 1000)}</span>
                            <span className="text-xs font-medium text-ink-3">{mins === 0 ? "now" : `in ${mins} min`}</span>
                            {o === best && <span className="rounded-full bg-highlight px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Best</span>}
                          </div>
                          <CrowdTag loadPct={o.peak} size="sm" showPct />
                        </div>
                        <div className="mt-2.5"><LegStrip o={o} line={line} dir={result.dir} from={engine.line.stopIndex[result.dir][from]} /></div>
                        <p className="mt-1.5 text-xs text-ink-3">Arrive <span className="num font-semibold text-ink-2">{klTime(o.arrive * 1000)}</span> · {o.minutes} min</p>
                      </li>
                    );
                  })}
                </ol>
                {result.options.length > 8 && (
                  <button type="button" onClick={() => setShowAll((v) => !v)} className="pressable mt-3 rounded-full bg-surface-2 px-4 py-2 text-sm font-semibold text-accent">
                    {showAll ? "Show fewer trains" : `Show all ${result.options.length} trains`}
                  </button>
                )}
              </Section>
              <Section title={`On a typical ${new Date(t * 1000).toLocaleDateString("en-GB", { weekday: "long", timeZone: "Asia/Kuala_Lumpur" })}`}
                note="The busiest stretch of this ride, hour by hour. Travelling outside the peak usually means a seat.">
                <div className="card p-4">
                  <HourBars values={typicalRide(engine, result.dir, engine.line.stopIndex[result.dir][from], engine.line.stopIndex[result.dir][to], weekdayOf(t))}
                    nowHour={hourOf(t)} label={`Typical peak load on a ride from ${names[from]} to ${names[to]} by hour`} />
                </div>
              </Section>
            </>
          )}
        </>
      )}
    </Page>
  );
}
