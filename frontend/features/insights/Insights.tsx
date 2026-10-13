"use client";

/**
 * Busy times (rider view, INS-01 to INS-03): three short answers, no charts to decode.
 * 1. Right now: are trains fuller than usual, and where is it worst.
 * 2. Your ride: the hours it is usually calmer, as one row of coloured hours you can tap.
 * 3. Every line now: which lines are busy at this moment, including the other lines (NETC-03).
 * The charts behind these are in the operator view's Analytics.
 */

import { ArrowRight, Info } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CrowdIcon, CrowdTag } from "@/components/Crowd";
import { LineBadge } from "@/components/LineBadge";
import { EmptyState, Skeleton } from "@/components/States";
import { StationPicker } from "@/components/StationPicker";
import { blocksAt } from "@/lib/advisor/advisor";
import { crowdInkVar, crowdOf, crowdSoftVar, crowdVar } from "@/lib/crowd/levels";
import { type CrowdEngine, hourOf, typicalRide, weekdayOf } from "@/lib/crowd/model";
import { FIRST_HOUR, hh, list, windows } from "@/lib/crowd/when";
import { klTime } from "@/lib/format";
import { useHome } from "@/lib/home";
import { useCrowd, useSimNow } from "@/lib/hooks";
import { usePrefs } from "@/lib/prefs";
import { NO_DISRUPTIONS, useTwin } from "@/lib/store";
import type { LineData } from "@/lib/types";
import { useLinesNow } from "./linesNow";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`mb-5 ${className}`} aria-label={title}>
      <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-ink-3">{title}</h2>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- right now

function RightNow({ engine, line, t }: { engine: CrowdEngine; line: LineData; t: number }) {
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  const mult = useTwin((s) => s.sim?.scenario.demand_mult ?? 1);
  const r = useMemo(() => {
    const now = engine.live(t, disruptions, mult);
    const usual = engine.live(t, [], 1);
    const avg = (xs: { loadPct: number }[]) => (xs.length ? xs.reduce((a, b) => a + b.loadPct, 0) / xs.length : 0);
    return { now: avg(now), usual: avg(usual), running: now.length, crowded: now.filter((x) => x.loadPct >= 75).length,
      blocked: blocksAt(engine, disruptions, t).length > 0 };
  }, [engine, t, disruptions, mult]);
  if (!r.running) {
    return <div className="card p-5 text-[15px] text-ink-2">No trains are running at <span className="num font-semibold text-ink">{klTime(t * 1000)}</span>. Service starts at about 06:00.</div>;
  }
  const ratio = r.usual > 0 ? r.now / r.usual : 1;
  const c = crowdOf(r.now);
  const day = DAY_NAMES[weekdayOf(t)];
  const compare = ratio > 1.1 ? `Busier than a usual ${day}` : ratio < 0.9 ? `Quieter than a usual ${day}` : `As busy as a usual ${day}`;
  return (
    <div className="overflow-hidden rounded-card shadow-card" style={{ background: crowdSoftVar(c.level) }}>
      <div className="flex items-center gap-4 p-5">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/75"><CrowdIcon level={c.level} size={30} /></span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-ink-2">Kelana Jaya Line · <span className="num">{klTime(t * 1000)}</span></p>
          <p className="text-[22px] font-extrabold leading-tight tracking-tight" style={{ color: crowdInkVar(c.level) }}>Mostly {c.name.toLowerCase()}</p>
          <p className="mt-0.5 text-[14px] text-ink-2">{compare}.</p>
        </div>
      </div>
      <p className="border-t border-black/5 bg-white/60 px-5 py-2.5 text-[13px] text-ink-2">
        {r.blocked ? <strong className="text-ink">Part of the line is not running, so nearby trains are fuller. </strong> : null}
        <span className="num font-semibold text-ink">{r.crowded}</span> of <span className="num">{r.running}</span> trains are crowded or packed.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- your ride

function HourStrip({ values, nowH, picked, onPick }: { values: (number | null)[]; nowH: number; picked: number | null; onPick: (h: number) => void }) {
  const hours = Array.from({ length: 24 - FIRST_HOUR }, (_, i) => FIRST_HOUR + i);
  return (
    <div>
      <div className="flex gap-0.75" role="radiogroup" aria-label="Hours of the day">
        {hours.map((h) => {
          const v = values[h];
          const c = v === null ? null : crowdOf(v);
          const on = picked === h;
          return (
            <button key={h} type="button" role="radio" aria-checked={on} onClick={() => onPick(h)}
              aria-label={`${hh(h)}: ${c ? c.name : "no trains"}`}
              className={`relative h-11 flex-1 rounded-md transition-transform ${on ? "scale-y-110 ring-2 ring-ink ring-offset-1" : ""}`}
              style={{ background: c ? crowdVar(c.level) : "var(--surface-3)" }}>
              {h === nowH && <span aria-hidden className="absolute -top-1.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-white bg-ink" />}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[11px] font-semibold text-ink-3">
        {[6, 9, 12, 15, 18, 21].map((h) => <span key={h} className="num">{hh(h)}</span>)}
        <span className="num">24:00</span>
      </div>
    </div>
  );
}

function YourRide({ engine, line, t }: { engine: CrowdEngine; line: LineData; t: number }) {
  const params = useSearchParams();
  const home = useHome((s) => s.id);
  const { rides } = usePrefs();
  // Busy times is about the Kelana Jaya Line: skip saved rides and links that leave it.
  const onLine = (id: string | null | undefined): id is string => !!id && id in engine.idx;
  const saved = rides.find((r) => onLine(r.from) && onLine(r.to));
  const [from, setFrom] = useState<string | null>(onLine(params.get("from")) ? params.get("from") : null);
  const [to, setTo] = useState<string | null>(onLine(params.get("to")) ? params.get("to") : null);
  const [day, setDay] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const o = from ?? saved?.from ?? home;
  const d = to ?? saved?.to ?? (o === "KJ15" ? "KJ10" : "KJ15");
  const wd = day ?? weekdayOf(t);
  const values = useMemo(() => {
    if (o === d) return null;
    const dir = engine.idx[d] > engine.idx[o] ? 1 : 0;
    return typicalRide(engine, dir, engine.line.stopIndex[dir][o], engine.line.stopIndex[dir][d], wd);
  }, [engine, o, d, wd]);
  const calm = values ? windows(values, (v) => crowdOf(v).level <= 2) : [];
  const busy = values ? windows(values, (v) => crowdOf(v).level >= 4) : [];
  const nowH = wd === weekdayOf(t) ? Math.floor(hourOf(t)) : -1;
  const pickedV = picked !== null && values ? values[picked] : null;

  return (
    <div className="card p-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0"><span className="mb-1 block text-[11px] font-semibold text-ink-3">From</span>
          <StationPicker stations={line.stations} value={o} onChange={setFrom} label="From" variant="field" /></div>
        <div className="min-w-0"><span className="mb-1 block text-[11px] font-semibold text-ink-3">To</span>
          <StationPicker stations={line.stations} value={d} onChange={setTo} label="To" variant="field" /></div>
      </div>
      <div className="-mx-4 mt-3 flex gap-1 overflow-x-auto px-4" role="radiogroup" aria-label="Day">
        {DAYS.map((x, i) => (
          <button key={x} type="button" role="radio" aria-checked={wd === i} onClick={() => { setDay(i); setPicked(null); }}
            className={`pressable shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${wd === i ? "bg-ink text-white" : "bg-surface-2 text-ink-2"}`}>
            {i === weekdayOf(t) ? "Today" : x}
          </button>
        ))}
      </div>
      {!values ? <p className="mt-4 text-sm text-ink-3">Pick two different stations.</p> : (
        <>
          <p className="mt-4 text-[18px] font-extrabold leading-snug text-ink">
            {calm.length ? <>Calmer {list(calm)}</> : <>Busy all day on {DAY_NAMES[wd]}</>}
          </p>
          {busy.length > 0 && <p className="mt-0.5 text-[14px] font-semibold" style={{ color: "var(--crowd-4-ink)" }}>Avoid {list(busy)}</p>}
          <div className="mt-4"><HourStrip values={values} nowH={nowH} picked={picked} onPick={setPicked} /></div>
          <p className="mt-3 min-h-5 text-[13px] text-ink-2" aria-live="polite">
            {picked === null ? "Tap an hour to see how full trains usually are."
              : pickedV === null ? <><span className="num font-bold text-ink">{hh(picked)}</span>: no trains.</>
              : <><span className="num font-bold text-ink">{hh(picked)}</span>: usually <strong style={{ color: crowdInkVar(crowdOf(pickedV).level) }}>{crowdOf(pickedV).name.toLowerCase()}</strong>, {crowdOf(pickedV).hint.toLowerCase()}.</>}
          </p>
          <Link href={`/trip?from=${o}&to=${d}`} className="pressable mt-3 inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2.5 text-[14px] font-bold text-white">
            Plan this ride <ArrowRight size={14} weight="bold" aria-hidden />
          </Link>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- every line

function EveryLine({ t }: { t: number }) {
  const { rows, ready } = useLinesNow(t);
  if (!ready && !rows.length) return <Skeleton className="h-48" />;
  if (!rows.length) return <div className="card p-4 text-[14px] text-ink-2">No trains are running right now.</div>;
  return (
    <ul className="card divide-y divide-rule overflow-hidden">
      {rows.map((r) => (
        <li key={r.def.id} className="flex items-center gap-3 px-4 py-3">
          <LineBadge line={r.def} size={30} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14.5px] font-bold text-ink">{r.def.name.replace(/ Line$/, "")}</span>
            <span className="block truncate text-[12px] text-ink-3">Busiest: {r.from} → {r.to}</span>
          </span>
          <CrowdTag loadPct={r.max} size="sm" />
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- page

export function Insights() {
  const { line, engine, error } = useCrowd("KJ");
  const now = useSimNow(30_000);
  const t = now / 1000;
  const loadHome = useHome((s) => s.load);
  const loadPrefs = usePrefs((s) => s.load);
  useEffect(() => loadPrefs(), [loadPrefs]);
  useEffect(() => {
    if (line) loadHome(line.stations.map((s) => s.id));
  }, [line, loadHome]);

  return (
    <main className="enter mx-auto max-w-xl px-4 pb-16 pt-5 sm:px-6 lg:pt-10">
      <h1 className="mb-4 text-[26px] font-extrabold leading-tight tracking-tight text-ink sm:text-3xl">Busy times</h1>
      {error ? <EmptyState title="Predictions are unavailable" body={error} /> : !line || !engine ? <Skeleton className="h-96" /> : (
        <>
          <Card title="Right now"><RightNow engine={engine} line={line} t={t} /></Card>
          <Card title="Your ride"><YourRide engine={engine} line={line} t={t} /></Card>
          <Card title="Every line now"><EveryLine t={t} /></Card>
          <p className="flex items-start gap-2 text-[12.5px] text-ink-3">
            <Info size={15} className="mt-0.5 shrink-0" aria-hidden />
            <span>Predicted from data.gov.my gate data and the timetable, not counted on the train. The Kelana Jaya Line reacts to live delays; other lines show what their trains usually carry at this hour. <Link href="/about" className="font-semibold text-accent">How it works</Link></span>
          </p>
        </>
      )}
    </main>
  );
}
