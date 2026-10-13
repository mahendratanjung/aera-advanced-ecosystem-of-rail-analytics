"use client";

/**
 * Analytics (operator view, VIEW-03): the charts behind the predictions, for staff who plan
 * service. Every line now, the Kelana Jaya Line through the week and along its length, demand
 * over time and how the model is built. Riders get the short answers on Busy times instead.
 */

import { useMemo, useState } from "react";
import { CrowdScale, CrowdTag } from "@/components/Crowd";
import { Label, Select } from "@/components/Field";
import { LineBadge } from "@/components/LineBadge";
import { Page, Section } from "@/components/Page";
import { EmptyState, Skeleton } from "@/components/States";
import { WeekHeatmap } from "@/features/charts/Heatmap";
import { HourBars } from "@/features/charts/HourBars";
import { LineProfile } from "@/features/charts/LineProfile";
import { TrendChart } from "@/features/charts/TrendChart";
import { pctShort } from "@/lib/crowd/levels";
import { type CrowdEngine, hourOf, weekdayOf } from "@/lib/crowd/model";
import { hh } from "@/lib/crowd/when";
import { useRequireRole } from "@/lib/guard";
import { useCrowd, useNetCrowd, useSimNow } from "@/lib/hooks";
import type { LineData } from "@/lib/types";
import { useLinesNow } from "./linesNow";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TABS = [
  { id: "lines", label: "All lines now" },
  { id: "week", label: "Through the week" },
  { id: "along", label: "Along the line" },
  { id: "demand", label: "Demand" },
  { id: "method", label: "Method" },
] as const;
type Tab = (typeof TABS)[number]["id"];

function AllLines({ t }: { t: number }) {
  const { rows, ready } = useLinesNow(t);
  if (!ready && !rows.length) return <Skeleton className="h-64" />;
  if (!rows.length) return <EmptyState title="No trains are running" body="Service runs from about 06:00 to midnight." />;
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-left text-[13.5px]">
        <thead className="bg-surface-2 text-[11.5px] font-semibold text-ink-3">
          <tr>
            <th scope="col" className="px-4 py-2.5">Line</th>
            <th scope="col" className="hidden px-3 py-2.5 text-right sm:table-cell">Trains</th>
            <th scope="col" className="hidden px-3 py-2.5 sm:table-cell">Average</th>
            <th scope="col" className="px-3 py-2.5">Fullest train</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {rows.map((r) => (
            <tr key={r.def.id}>
              <td className="px-4 py-3">
                <span className="flex items-center gap-2.5">
                  <LineBadge line={r.def} size={26} />
                  <span className="min-w-0">
                    <span className="block font-bold leading-tight text-ink">{r.def.name.replace(/ Line$/, "")}</span>
                    <span className="block text-[11.5px] text-ink-3">{r.kind === "live" ? "Live twin: reacts to delays" : "Typical for this hour"}</span>
                  </span>
                </span>
              </td>
              <td className="num hidden px-3 py-3 text-right text-ink-2 sm:table-cell">{r.running}</td>
              <td className="hidden px-3 py-3 sm:table-cell"><CrowdTag loadPct={r.mean} size="sm" showPct /></td>
              <td className="px-3 py-3">
                <CrowdTag loadPct={r.max} size="sm" showPct />
                <span className="mt-0.5 block text-[11.5px] text-ink-3">{r.from} → {r.to}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-rule px-4 py-2.5 text-[12px] text-ink-3">
        ERL, BRT Sunway and the Skypark Link publish no ridership, so they are not listed. Other lines use approximate train capacities; see Method.
      </p>
    </div>
  );
}

function BusiestToday({ engine, line, t }: { engine: CrowdEngine; line: LineData; t: number }) {
  const wd = weekdayOf(t);
  const top = useMemo(() => {
    const all: { dir: number; seg: number; peak: number; hour: number; values: (number | null)[] }[] = [];
    for (const dir of [0, 1]) {
      for (let seg = 0; seg < line.stations.length - 1; seg++) {
        const values = engine.typicalDay(dir, seg, wd);
        let peak = 0;
        let hour = 8;
        values.forEach((v, h) => { if (v !== null && v > peak) { peak = v; hour = h; } });
        all.push({ dir, seg, peak, hour, values });
      }
    }
    return all.sort((a, b) => b.peak - a.peak).slice(0, 3);
  }, [engine, line, wd]);
  const names = Object.fromEntries(line.stations.map((s) => [s.id, s.name]));
  const heads = Object.fromEntries(line.directions.map((d) => [d.direction_id, d.headsign]));
  const segName = (dir: number, seg: number) => dir === 1
    ? `${names[line.stations[seg].id]} → ${names[line.stations[seg + 1].id]}`
    : `${names[line.stations[seg + 1].id]} → ${names[line.stations[seg].id]}`;
  return (
    <ol className="grid gap-3 md:grid-cols-3">
      {top.map((x) => (
        <li key={`${x.dir}:${x.seg}`} className="card p-4">
          <p className="text-[15px] font-bold leading-tight text-ink">{segName(x.dir, x.seg)}</p>
          <p className="mt-0.5 text-[12px] text-ink-3">Towards {heads[x.dir]} · worst around <span className="num">{hh(x.hour)}</span></p>
          <div className="mt-2"><CrowdTag loadPct={x.peak} size="sm" showPct /></div>
          <div className="mt-2"><HourBars values={x.values} nowHour={hourOf(t)} label={`Typical crowding by hour on ${segName(x.dir, x.seg)}`} /></div>
        </li>
      ))}
    </ol>
  );
}

export function Analytics() {
  const { user, ready } = useRequireRole("operator");
  const { line, engine, error } = useCrowd("KJ");
  const netModel = useNetCrowd();
  const now = useSimNow(60_000);
  const t = now / 1000;
  const [tab, setTab] = useState<Tab>("lines");
  const [stn, setStn] = useState<string | null>(null);
  const [hmDir, setHmDir] = useState<number | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [hour, setHour] = useState<number | null>(null);

  const stats = useMemo(() => {
    if (!engine || !line) return null;
    const daily = engine.data.trend.daily;
    const recent = daily.slice(-84);
    const t0 = Date.parse(`${engine.data.trend.start}T00:00:00Z`) + (daily.length - recent.length) * 86400000;
    const weekdays = recent.filter((_, i) => { const d = new Date(t0 + i * 86400000).getUTCDay(); return d >= 1 && d <= 5; }).sort((a, b) => a - b);
    const median = weekdays[Math.floor(weekdays.length / 2)] ?? 0;
    const boards = engine.stationBoardingsTypical(1).sort((a, b) => b.total - a.total);
    return { median, boards };
  }, [engine, line]);

  if (!ready || !user) return <Page title="Analytics"><p className="text-ink-2">Checking your session…</p></Page>;
  if (error) return <Page title="Analytics"><EmptyState title="Analytics are unavailable" body={error} /></Page>;
  if (!line || !engine || !stats) return <Page wide title="Analytics"><Skeleton className="h-96" /></Page>;

  const names = Object.fromEntries(line.stations.map((s) => [s.id, s.name]));
  const heads = Object.fromEntries(line.directions.map((d) => [d.direction_id, d.headsign]));
  const hs = stn ?? "KJ14";
  const hi = engine.idx[hs];
  const dir = hmDir ?? (hi === 0 ? 1 : 0);
  const seg = dir === 1 ? Math.min(hi, line.stations.length - 2) : Math.max(0, hi - 1);
  const segLabel = dir === 1 ? `${names[line.stations[seg].id]} → ${names[line.stations[seg + 1].id]}` : `${names[line.stations[seg + 1].id]} → ${names[line.stations[seg].id]}`;
  const grid = Array.from({ length: 7 }, (_, w) => engine.typicalDay(dir, seg, w));
  const pDay = day ?? weekdayOf(t);
  const pHour = hour ?? Math.min(23, Math.max(6, Math.floor(hourOf(t))));
  const profile = [0, 1].map((d) => line.stations.slice(0, -1).map((_, s) => engine.typicalDay(d, s, pDay)[pHour] ?? 0));
  const maxBoard = stats.boards[0].total;
  const m = engine.data;

  return (
    <Page wide title="Analytics" eyebrow="Operator view"
      intro={<>About <strong className="num text-ink">{Math.round(stats.median / 1000)}k</strong> journeys ride the Kelana Jaya Line on a typical weekday. Crowding is predicted from data.gov.my gate data.</>}>
      <div role="tablist" aria-label="Analytics" className="-mx-4 mb-6 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-1 rounded-full bg-surface-2 p-1">
          {TABS.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}
              className={`pressable shrink-0 rounded-full px-4 py-2 text-[13px] font-semibold ${tab === x.id ? "bg-white text-ink shadow-sm" : "text-ink-3 hover:text-ink"}`}>
              {x.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "lines" && (
        <>
          <Section title="Every line, right now" note="Sorted by the fullest train. Kelana Jaya is the live twin; the others are what their trains usually carry at this hour.">
            <AllLines t={t} />
          </Section>
          <Section title={`Busiest Kelana Jaya stretches on a typical ${DAYS[weekdayOf(t)]}`}>
            <BusiestToday engine={engine} line={line} t={t} />
          </Section>
        </>
      )}

      {tab === "week" && (
        <Section title="Through the week" note="Typical crowding on one stretch, by day and hour. Tap a cell for its reading.">
          <div className="mb-4 grid max-w-xl gap-3 sm:grid-cols-2">
            <div><Label htmlFor="hm-st">Leaving station</Label>
              <Select id="hm-st" value={hs} onChange={(e) => setStn(e.target.value)}>{line.stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
            <div><Label htmlFor="hm-dir">Towards</Label>
              <Select id="hm-dir" value={dir} onChange={(e) => setHmDir(Number(e.target.value))}>{[0, 1].map((x) => <option key={x} value={x}>{heads[x]}</option>)}</Select></div>
          </div>
          <div className="card p-4">
            <p className="mb-2 text-[13px] font-semibold text-ink">{segLabel}</p>
            <WeekHeatmap grid={grid} label={`Typical crowding on ${segLabel} by weekday and hour`} now={{ day: weekdayOf(t), hour: Math.floor(hourOf(t)) }} />
            <div className="mt-3 border-t border-rule pt-3"><CrowdScale compact /></div>
          </div>
        </Section>
      )}

      {tab === "along" && (
        <Section title="Along the line" note="How full trains are on every stretch at one moment. Tap a stretch for its readings.">
          <div className="mb-4 flex flex-wrap items-end gap-4">
            <div className="w-44">
              <Label htmlFor="day">Day</Label>
              <Select id="day" value={pDay} onChange={(e) => setDay(Number(e.target.value))}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select>
            </div>
            <div className="min-w-55 flex-1">
              <Label htmlFor="hour">Time <span className="num normal-case tracking-normal text-ink">{hh(pHour)}</span></Label>
              <input id="hour" type="range" min={6} max={23} value={pHour} onChange={(e) => setHour(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
            </div>
          </div>
          <div className="card p-4"><LineProfile line={line} loads={profile} label={`Typical load on each stretch, ${DAYS[pDay]} ${pHour}:00`} /></div>
        </Section>
      )}

      {tab === "demand" && (
        <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-[1.4fr_1fr]">
          <Section title="Journeys per day" note="Every journey that rides the line, from gate taps. Dips are public holidays and festive seasons.">
            <div className="card p-4"><TrendChart start={m.trend.start} daily={m.trend.daily} /></div>
          </Section>
          <Section title="Where people board" note="Typical weekday boardings, both directions.">
            <ol className="card divide-y divide-rule px-4">
              {stats.boards.slice(0, 10).map((b) => (
                <li key={b.id} className="grid grid-cols-[1fr_90px] items-center gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate text-ink">{names[b.id]}</span>
                    <span className="mt-1 block h-1.5 rounded-full bg-accent" style={{ width: `${(b.total / maxBoard) * 100}%` }} />
                  </span>
                  <span className="num text-right text-ink-2">{Math.round(b.total).toLocaleString("en-GB")}</span>
                </li>
              ))}
            </ol>
          </Section>
        </div>
      )}

      {tab === "method" && (
        <Section title="How the prediction works">
          <div className="grid gap-6 text-sm leading-relaxed text-ink-2 md:grid-cols-2">
            <div>
              <h3 className="mb-1 font-semibold text-ink">Kelana Jaya Line (live twin)</h3>
              <p>data.gov.my publishes daily journeys between every pair of Rapid Rail stations, from gate taps. We use the {m.window.weeks} weeks from {m.window.from} to {m.window.to} and the median for each weekday, so holidays do not skew it. Each journey is placed on the stretches it rides; the hour-by-hour shape comes from KTM Komuter&apos;s hourly taps. Passengers per hour divided by trains per hour give each train&apos;s load against its 800-person capacity, and live gaps between trains, held trains and disruptions move it from there.</p>
              <p className="mt-2">Back-test: forecasting each of the last 28 days from the weeks before it, the daily total was within <strong className="text-ink">{m.accuracy.mape_pct}%</strong> on a typical day.</p>
            </div>
            <div>
              <h3 className="mb-1 font-semibold text-ink">Every other line (typical week)</h3>
              <p>The same Rapid Rail journeys are routed across the whole network by the quickest path, so a ride that changes lines counts on every line it uses. KTM Komuter has hourly journeys of its own. Where two lines share track (Ampang and Sri Petaling, the Komuter core) riders are shared by every train that passes.</p>
              {netModel && (
                <p className="mt-2">Window {netModel.window.from} to {netModel.window.to}. Capacities used (approximate, seated and standing):{" "}
                  {Object.entries(netModel.capacity).map(([k, v]) => `${k} ${v}`).join(", ")}. These lines do not react to delays.</p>
              )}
              <p className="mt-2">Hour and car figures are less certain than daily ones. Komuter riders travel more at peak than LRT riders, so the sharpest Rapid Rail peaks may be overstated; a reading of {pctShort(100)} means more people want the train than fit.</p>
            </div>
          </div>
        </Section>
      )}
    </Page>
  );
}
