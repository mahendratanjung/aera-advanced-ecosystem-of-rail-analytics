"use client";

/**
 * Plan a ride (PLAN-01 to PLAN-04), phone first. One question, one answer: which train to take
 * between two Kelana Jaya stations. The answer card comes first (take the next train, or wait a
 * few minutes for a calmer one), then the next trains as a short list, then one line on when
 * this ride is usually calmer. Charts live on Busy times.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowsDownUp, CaretDown, Clock, Lightbulb, MapPin, Star } from "@phosphor-icons/react/dist/ssr";
import { CrowdIcon, CrowdTag } from "@/components/Crowd";
import { EmptyState, Skeleton } from "@/components/States";
import { StationPicker } from "@/components/StationPicker";
import { OtherWays, RouteOptionCard } from "@/features/advisor/RouteOptions";
import { advise } from "@/lib/advisor/advisor";
import { crowdInkVar, crowdOf, crowdSoftVar, crowdVar } from "@/lib/crowd/levels";
import { type TripOption, calmestOption, typicalRide, weekdayOf } from "@/lib/crowd/model";
import { list, windows } from "@/lib/crowd/when";
import { klTime } from "@/lib/format";
import { useHome } from "@/lib/home";
import { useCrowd, useNetCrowd, useNetwork, useSimNow } from "@/lib/hooks";
import type { Advice } from "@/lib/advisor/advisor";
import type { NetIndex } from "@/lib/advisor/network";
import type { PickStation } from "@/lib/stationSearch";
import { sameRide, usePrefs } from "@/lib/prefs";
import { NO_DISRUPTIONS, useTwin } from "@/lib/store";
import type { LineData } from "@/lib/types";

const WINDOW_S = 75 * 60;
const SHOWN = 5;
/** Never suggest waiting longer than this for a calmer train. */
const MAX_WAIT_S = 20 * 60;

/** The ride as a bar: one piece per stretch, coloured by how full the train is there. */
function RideBar({ o, line, dir, from, tall = false }: { o: TripOption; line: LineData; dir: number; from: number; tall?: boolean }) {
  const stops = line.directions.find((d) => d.direction_id === dir)!.stops;
  const names = Object.fromEntries(line.stations.map((s) => [s.id, s.name]));
  return (
    <span className="flex gap-[2px]" role="img"
      aria-label={o.legLoads.map((l, i) => `${names[stops[from + i].station_id]} to ${names[stops[from + i + 1].station_id]} ${crowdOf(l).name}`).join(", ")}>
      {o.legLoads.map((l, i) => (
        <span key={i} title={`${names[stops[from + i].station_id]} → ${names[stops[from + i + 1].station_id]}: ${crowdOf(l).name}`}
          className={`${tall ? "h-3" : "h-2"} min-w-[5px] flex-1 rounded-full`} style={{ background: crowdVar(crowdOf(l).level) }} />
      ))}
    </span>
  );
}

/** YOU-02: keep this ride on the You page and as a chip here. */
function SaveRide({ from, to }: { from: string; to: string }) {
  const { rides, toggleRide } = usePrefs();
  const saved = rides.some((r) => sameRide(r, { from, to }));
  return (
    <button type="button" aria-pressed={saved} onClick={() => toggleRide({ from, to })}
      className={`pressable inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-[14px] font-semibold ${saved ? "border-highlight/40 bg-highlight-soft text-highlight" : "border-rule bg-white text-ink-2 hover:bg-surface-2"}`}>
      <Star size={16} weight={saved ? "fill" : "regular"} aria-hidden />{saved ? "Saved" : "Save"}
    </button>
  );
}

/** The answer: which train to take, how full it will be, and why not the next one. */
function Answer({ best, first, t, line, dir, from, names, to, later }: {
  best: TripOption; first: TripOption; t: number; line: LineData; dir: number; from: number; names: Record<string, string>; to: string;
  later: TripOption | null;
}) {
  const c = crowdOf(best.peak);
  const wait = Math.max(0, Math.round((best.depart - t) / 60));
  const isNext = best === first;
  const headline = isNext
    ? c.level <= 2 ? "Take the next train" : "Take the next train. The ones soon after are no calmer"
    : `Wait ${Math.max(1, Math.round((best.depart - first.depart) / 60))} min for a calmer train`;
  return (
    <section aria-label="Our suggestion" className="mt-4 overflow-hidden rounded-card shadow-card" style={{ background: crowdSoftVar(c.level) }}>
      <div className="p-4">
        <p className="text-[13px] font-bold" style={{ color: crowdInkVar(c.level) }}>{headline}</p>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div>
            <p className="num text-[40px] font-extrabold leading-none tracking-tight text-ink">{klTime(best.depart * 1000)}</p>
            <p className="mt-1.5 text-[13.5px] text-ink-2">
              {wait === 0 ? "Leaving now" : `In ${wait} min`} · arrive <span className="num font-bold text-ink">{klTime(best.arrive * 1000)}</span> · {best.minutes} min
            </p>
          </div>
          <div className="flex flex-col items-center gap-1 rounded-2xl bg-white/75 px-3 py-2">
            <CrowdIcon level={c.level} size={26} />
            <span className="text-[13px] font-extrabold" style={{ color: crowdInkVar(c.level) }}>{c.name}</span>
          </div>
        </div>
        <div className="mt-4">
          <RideBar o={best} line={line} dir={dir} from={from} tall />
          <div className="mt-1 flex justify-between text-[11.5px] font-semibold text-ink-3">
            <span>{names[line.directions.find((d) => d.direction_id === dir)!.stops[from].station_id]}</span>
            <span>{names[to]}</span>
          </div>
        </div>
      </div>
      <p className="border-t border-black/5 bg-white/60 px-4 py-2.5 text-[13px] text-ink-2">
        {c.hint} at the busiest point.
        {!isNext && <> The next train, at <span className="num font-semibold text-ink">{klTime(first.depart * 1000)}</span>, will be {crowdOf(first.peak).name.toLowerCase()}.</>}
        {later && <> If you can wait, trains get {crowdOf(later.peak).name.toLowerCase()} from <span className="num font-semibold text-ink">{klTime(later.depart * 1000)}</span>.</>}
      </p>
    </section>
  );
}

function TrainRow({ o, t, best, line, dir, from }: { o: TripOption; t: number; best: boolean; line: LineData; dir: number; from: number }) {
  const [open, setOpen] = useState(false);
  const mins = Math.max(0, Math.round((o.depart - t) / 60));
  return (
    <li>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className={`pressable flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 ${best ? "bg-highlight-soft/50" : ""}`}>
        <span className="w-14 shrink-0">
          <span className="num block text-[17px] font-extrabold leading-tight text-ink">{klTime(o.depart * 1000)}</span>
          <span className="block text-[11.5px] font-medium text-ink-3">{mins === 0 ? "now" : `in ${mins} min`}</span>
        </span>
        <span className="min-w-0 flex-1">
          {best && <span className="mr-1.5 rounded-full bg-highlight px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Best</span>}
          <span className="text-[12.5px] text-ink-3">arrive <span className="num font-semibold text-ink-2">{klTime(o.arrive * 1000)}</span></span>
        </span>
        <CrowdTag loadPct={o.peak} size="sm" />
        <CaretDown size={14} className={`shrink-0 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="px-4 pb-3">
          <RideBar o={o} line={line} dir={dir} from={from} />
          <p className="mt-1.5 text-[12px] text-ink-3">Each piece is one stretch of your ride, coloured by how full the train is there.</p>
        </div>
      )}
    </li>
  );
}

/** Every Rapid Rail station once, Kelana Jaya first; interchanges keep their Kelana Jaya stop. */
function pickList(ix: NetIndex, line: LineData): PickStation[] {
  const out: PickStation[] = line.stations.map((s) => ({ id: s.id, name: s.name, color: "var(--line-kj)" }));
  const seen = new Set(out.map((s) => s.name.toLowerCase()));
  for (const l of ix.net.lines) {
    if (l.id === "KJ") continue;
    for (const s of l.stops) {
      if (seen.has(s.name.toLowerCase())) continue;
      seen.add(s.name.toLowerCase());
      out.push({ id: s.id, name: s.name, color: l.color ?? undefined });
    }
  }
  return out;
}

/** PLAN-06: rides that leave the Kelana Jaya Line: each way there, fastest first, crowding on every leg. */
function CrossLine({ advice, t }: { advice: Advice | null; t: number }) {
  if (!advice) return <Skeleton className="mt-5 h-40" />;
  if (advice.block) return null; // OtherWays above already shows these
  const options = [...advice.options].sort((a, b) => a.arrive - b.arrive);
  if (!options.length) return <div className="mt-5"><EmptyState title="No way found at this time" body="Trains run from about 06:00 to midnight. Try a later time." /></div>;
  return (
    <section className="mt-5" aria-labelledby="ways">
      <h2 id="ways" className="mb-2 text-[17px] font-bold text-ink">{options.length > 1 ? "Ways to get there" : "Your ride"}</h2>
      <ol className="space-y-3">
        {options.map((o, i) => <RouteOptionCard key={o.id} o={o} best={i === 0 && options.length > 1} now={t} />)}
      </ol>
      <p className="mt-2 text-xs text-ink-3">Kelana Jaya crowding reacts to delays; other lines show what their trains usually carry at this hour. Times off the Kelana Jaya Line and walks between lines are estimates.</p>
    </section>
  );
}

export function TripPlanner() {
  const { line, engine, error } = useCrowd("KJ");
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const now = useSimNow(5000);
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  const mult = useTwin((s) => s.sim?.scenario.demand_mult ?? 1);
  const home = useHome((s) => s.id);
  const loadHome = useHome((s) => s.load);
  const { rides, load } = usePrefs();
  useEffect(() => load(), [load]);
  useEffect(() => {
    if (line) loadHome(line.stations.map((s) => s.id));
  }, [line, loadHome]);
  const from = params.get("from") ?? home;
  const to = params.get("to") ?? (from === "KJ15" ? "KJ10" : "KJ15");
  const [later, setLater] = useState("");
  const [showAll, setShowAll] = useState(false);

  const setRide = (f: string, d: string) => {
    const q = new URLSearchParams(params.toString());
    q.set("from", f);
    q.set("to", d);
    router.replace(`${path}?${q}`, { scroll: false });
  };

  const t = useMemo(() => {
    const base = now / 1000;
    if (!later) return base;
    const [h, m] = later.split(":").map(Number);
    const dayStart = Math.floor((base + 8 * 3600) / 86400) * 86400 - 8 * 3600;
    const at = dayStart + h * 3600 + m * 60;
    return at < base - 600 ? at + 86400 : at;
  }, [now, later]);

  const { ix } = useNetwork();
  const netCrowd = useNetCrowd();
  // PLAN-06: a ride with an end off the Kelana Jaya Line is planned by the route advisor.
  const kjRide = !!engine && from in engine.idx && to in engine.idx;
  const result = useMemo(() => (engine && kjRide ? engine.trip(from, to, t, disruptions, mult, WINDOW_S) : null), [engine, kjRide, from, to, t, disruptions, mult]);
  // ROUTE-02: when the ride runs into a disruption, offer other ways first.
  const advice = useMemo(() => (ix && engine && from !== to ? advise(ix, engine, from, to, t, disruptions, mult, netCrowd) : null), [ix, engine, from, to, t, disruptions, mult, netCrowd]);
  const stations = useMemo(() => (ix && line ? pickList(ix, line) : line?.stations ?? []), [ix, line]);
  const best = result ? calmestOption(result.options.filter((o) => o.depart <= result.options[0].depart + MAX_WAIT_S)) : null;
  // A calmer train beyond the wait we would suggest, worth a mention.
  const laterCalm = result && best ? result.options.find((o) => o.depart > best.depart && crowdOf(o.peak).level < crowdOf(best.peak).level) ?? null : null;
  const names: Record<string, string> = {
    ...(ix ? Object.fromEntries(Object.values(ix.stop).map((s) => [s.id, s.name])) : {}),
    ...(line ? Object.fromEntries(line.stations.map((s) => [s.id, s.name])) : {}),
  };
  const calm = useMemo(() => {
    if (!engine || !result) return [];
    const ko = engine.line.stopIndex[result.dir][from];
    const kd = engine.line.stopIndex[result.dir][to];
    return windows(typicalRide(engine, result.dir, ko, kd, weekdayOf(t)), (v) => crowdOf(v).level <= 2);
  }, [engine, result, from, to, t]);

  const chips = rides.filter((r) => !sameRide(r, { from, to })).slice(0, 4);

  return (
    <main className="enter mx-auto max-w-xl px-4 pb-16 pt-5 sm:px-6 lg:pt-10">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-ink sm:text-3xl">Plan a ride</h1>
        {from !== to && line && <SaveRide from={from} to={to} />}
      </header>
      {error && <EmptyState title="Predictions are unavailable" body={error} />}
      {!line || !engine ? <Skeleton className="h-48" /> : (
        <>
          <form className="card-raised relative p-1.5" onSubmit={(e) => e.preventDefault()}>
            <div className="pr-14">
              <StationPicker stations={stations} value={from} onChange={(id) => setRide(id, to)} label="From"
                icon={<span aria-hidden className="h-3.5 w-3.5 shrink-0 rounded-full border-[3px] border-accent" />} />
            </div>
            <div className="ml-[24px] mr-14 h-px bg-rule" />
            <div className="pr-14">
              <StationPicker stations={stations} value={to} onChange={(id) => setRide(from, id)} label="To"
                icon={<MapPin size={15} weight="fill" className="shrink-0 text-highlight" aria-hidden />} />
            </div>
            <button type="button" aria-label="Swap start and end" onClick={() => setRide(to, from)}
              className="pressable absolute right-3.5 top-[44px] flex h-11 w-11 items-center justify-center rounded-full border border-rule bg-white text-ink-2 shadow-sm hover:text-accent">
              <ArrowsDownUp size={19} weight="bold" aria-hidden />
            </button>
            <div className="mt-1 flex items-center gap-2 border-t border-rule px-3 pb-1.5 pt-2.5">
              <Clock size={16} className="text-ink-3" aria-hidden />
              <span className="text-[13px] font-semibold text-ink-2">Leave</span>
              <div role="group" aria-label="When" className="ml-auto flex items-center gap-1 rounded-full bg-surface-2 p-1">
                <button type="button" aria-pressed={!later} onClick={() => setLater("")}
                  className={`pressable rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${!later ? "bg-white text-ink shadow-sm" : "text-ink-3"}`}>Now</button>
                <input type="time" value={later} onChange={(e) => setLater(e.target.value)} aria-label="Leave at a time"
                  className={`rounded-full px-2 py-1.5 text-[13px] font-semibold ${later ? "bg-white text-ink shadow-sm" : "bg-transparent text-ink-3"}`} />
              </div>
            </div>
          </form>

          {chips.length > 0 && (
            <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Saved rides">
              {chips.map((r) => (
                <button key={`${r.from}-${r.to}`} type="button" onClick={() => setRide(r.from, r.to)}
                  className="pressable flex shrink-0 items-center gap-1.5 rounded-full border border-rule bg-white px-3 py-2 text-[13px] font-semibold text-ink-2 hover:bg-surface-2">
                  <Star size={13} weight="fill" className="text-highlight" aria-hidden />
                  {names[r.from]} <ArrowRight size={12} aria-label="to" /> {names[r.to]}
                </button>
              ))}
            </div>
          )}

          {advice?.block && <OtherWays advice={advice} names={names} now={t} />}

          {from === to ? (
            <div className="mt-5"><EmptyState title="Pick two different stations" /></div>
          ) : !kjRide ? (
            <CrossLine advice={advice} t={t} />
          ) : !result || result.options.length === 0 ? (
            advice?.block ? null : <div className="mt-5"><EmptyState title="No trains at this time" body="Trains run from about 06:00 to 23:15. Try a later time." /></div>
          ) : (
            <>
              {best && <Answer best={best} first={result.options[0]} t={t} line={line} dir={result.dir} names={names} to={to}
                from={engine.line.stopIndex[result.dir][from]} later={laterCalm} />}

              <section className="mt-6" aria-labelledby="next-trains">
                <div className="mb-2 flex items-baseline justify-between">
                  <h2 id="next-trains" className="text-[17px] font-bold text-ink">Next trains</h2>
                  <span className="text-[12px] text-ink-3">Towards {line.directions.find((d) => d.direction_id === result.dir)!.headsign}</span>
                </div>
                <ol className="card divide-y divide-rule overflow-hidden">
                  {(showAll ? result.options : result.options.slice(0, SHOWN)).map((o) => (
                    <TrainRow key={o.run.trip.id} o={o} t={t} best={o === best} line={line} dir={result.dir} from={engine.line.stopIndex[result.dir][from]} />
                  ))}
                </ol>
                {result.options.length > SHOWN && (
                  <button type="button" onClick={() => setShowAll((v) => !v)} className="pressable mt-2 w-full rounded-full bg-surface-2 py-2.5 text-[13px] font-semibold text-accent">
                    {showAll ? "Show fewer" : `Show ${result.options.length - SHOWN} more`}
                  </button>
                )}
              </section>

              <Link href={`/insights?from=${from}&to=${to}`} className="pressable mt-5 flex items-start gap-3 rounded-card bg-accent-soft p-4 text-[14px] text-ink hover:bg-accent-soft/70">
                <Lightbulb size={20} weight="fill" className="mt-0.5 shrink-0 text-accent" aria-hidden />
                <span className="min-w-0 flex-1">
                  {calm.length ? <>This ride is usually calmer <strong>{list(calm)}</strong>.</> : <>This ride is busy most of the day.</>}
                  <span className="mt-0.5 block text-[12.5px] font-semibold text-accent">See busy times <ArrowRight size={12} weight="bold" className="inline" aria-hidden /></span>
                </span>
              </Link>
            </>
          )}
        </>
      )}
    </main>
  );
}
