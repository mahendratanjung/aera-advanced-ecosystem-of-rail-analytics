"use client";

import { useMemo, useState } from "react";
import { Label, Select } from "@/components/Field";
import { Page, Section } from "@/components/Page";
import { CrowdScale } from "@/components/Crowd";
import { EmptyState, Skeleton } from "@/components/States";
import { WeekHeatmap } from "@/features/charts/Heatmap";
import { LineProfile } from "@/features/charts/LineProfile";
import { TrendChart } from "@/features/charts/TrendChart";
import { crowdOf } from "@/lib/crowd/levels";
import { hourOf, weekdayOf } from "@/lib/crowd/model";
import { useCrowd, useSimNow } from "@/lib/hooks";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function Insights() {
  const { line, engine, error } = useCrowd("KJ");
  const now = useSimNow(60_000);
  const t = now / 1000;
  const [segKey, setSegKey] = useState<string | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [hour, setHour] = useState<number | null>(null);

  const stats = useMemo(() => {
    if (!engine || !line) return null;
    // Busiest stretch: highest typical per-train load on a weekday.
    let best = { dir: 0, seg: 0, h: 8, v: 0 };
    for (const dir of [0, 1]) {
      for (let seg = 0; seg < line.stations.length - 1; seg++) {
        engine.typicalDay(dir, seg, 1).forEach((v, h) => {
          if (v !== null && v > best.v) best = { dir, seg, h, v };
        });
      }
    }
    const daily = engine.data.trend.daily;
    const recent = daily.slice(-84);
    const t0 = Date.parse(`${engine.data.trend.start}T00:00:00Z`) + (daily.length - recent.length) * 86400000;
    const weekdays = recent.filter((_, i) => { const d = new Date(t0 + i * 86400000).getUTCDay(); return d >= 1 && d <= 5; }).sort((a, b) => a - b);
    const median = weekdays[Math.floor(weekdays.length / 2)] ?? 0;
    const boards = engine.stationBoardingsTypical(1).sort((a, b) => b.total - a.total);
    return { best, median, boards };
  }, [engine, line]);

  if (error) return <Page title="Insights"><EmptyState title="Insights are unavailable" body={error} /></Page>;
  if (!line || !engine || !stats) return <Page title="When is the line busiest?"><Skeleton className="h-96" /></Page>;

  const names = Object.fromEntries(line.stations.map((s) => [s.id, s.name]));
  const heads = Object.fromEntries(line.directions.map((d) => [d.direction_id, d.headsign]));
  const [selDir, selSeg] = segKey ? segKey.split(":").map(Number) : [stats.best.dir, stats.best.seg];
  const segName = (dir: number, seg: number) => dir === 1
    ? `${names[line.stations[seg].id]} → ${names[line.stations[seg + 1].id]}`
    : `${names[line.stations[seg + 1].id]} → ${names[line.stations[seg].id]}`;
  const grid = Array.from({ length: 7 }, (_, w) => engine.typicalDay(selDir, selSeg, w));
  const pDay = day ?? weekdayOf(t);
  const pHour = hour ?? Math.min(23, Math.max(6, Math.floor(hourOf(t))));
  const profile = [0, 1].map((dir) => line.stations.slice(0, -1).map((_, seg) => engine.typicalDay(dir, seg, pDay)[pHour] ?? 0));
  const maxBoard = stats.boards[0].total;
  const m = engine.data;

  return (
    <Page wide title="When is the line busiest?"
      intro={<>On a typical weekday about <strong className="num text-ink">{Math.round(stats.median / 1000)}k</strong> journeys use the Kelana Jaya Line.
        The most crowded stretch is <strong className="text-ink">{segName(stats.best.dir, stats.best.seg)}</strong> around <span className="num">{String(stats.best.h).padStart(2, "0")}:00</span>
        {stats.best.v >= 100
          ? <>, where more people want to travel than the trains can carry: they leave full and some riders wait for the next one.</>
          : <>, where trains run about <strong className="num text-ink">{Math.round(stats.best.v)}%</strong> full ({crowdOf(stats.best.v).name.toLowerCase()}).</>}</>}>

      <Section id="week" title="Through the week" note="Typical crowding on one stretch of the line, by day and hour. Pick any stretch.">
        <div className="mb-4 max-w-md">
          <Label htmlFor="seg">Stretch</Label>
          <Select id="seg" value={`${selDir}:${selSeg}`} onChange={(e) => setSegKey(e.target.value)}>
            {[0, 1].map((dir) => (
              <optgroup key={dir} label={`Towards ${heads[dir]}`}>
                {line.stations.slice(0, -1).map((_, seg) => <option key={seg} value={`${dir}:${seg}`}>{segName(dir, seg)}</option>)}
              </optgroup>
            ))}
          </Select>
        </div>
        <div className="card p-4">
          <WeekHeatmap grid={grid} label={`Typical crowding on ${segName(selDir, selSeg)} by weekday and hour`} now={{ day: weekdayOf(t), hour: Math.floor(hourOf(t)) }} />
          <div className="mt-3 border-t border-rule pt-3"><CrowdScale compact /></div>
        </div>
      </Section>

      <Section id="along" title="Along the line" note="How full trains are on every stretch at one moment. Morning trains fill towards the city, evening trains on the way out.">
        <div className="mb-4 flex flex-wrap items-end gap-4">
          <div className="w-44">
            <Label htmlFor="day">Day</Label>
            <Select id="day" value={pDay} onChange={(e) => setDay(Number(e.target.value))}>
              {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </Select>
          </div>
          <div className="min-w-[220px] flex-1">
            <Label htmlFor="hour">Time <span className="num normal-case tracking-normal text-ink">{String(pHour).padStart(2, "0")}:00</span></Label>
            <input id="hour" type="range" min={6} max={23} value={pHour} onChange={(e) => setHour(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
          </div>
        </div>
        <div className="card p-4">
          <LineProfile line={line} loads={profile} label={`Typical load on each stretch, ${DAYS[pDay]} ${pHour}:00`} />
        </div>
      </Section>

      <div className="grid gap-x-10 lg:grid-cols-[1.4fr_1fr]">
        <Section id="trend" title="Journeys per day" note="Every journey that rides the line, from gate taps. Dips are public holidays and festive seasons.">
          <div className="card p-4"><TrendChart start={m.trend.start} daily={m.trend.daily} /></div>
        </Section>
        <Section id="boarding" title="Where people board" note="Typical weekday boardings, both directions.">
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

      <Section id="method" title="How the prediction works">
        <div className="grid gap-6 text-sm leading-relaxed text-ink-2 md:grid-cols-3">
          <div>
            <h3 className="mb-1 font-semibold text-ink">The data</h3>
            <p>Every journey on Rapid Rail is a gate tap in and a tap out. data.gov.my publishes daily counts for every pair of stations. We use the {m.window.weeks} weeks from {m.window.from} to {m.window.to}, and the median for each weekday, so holidays do not skew the picture.</p>
          </div>
          <div>
            <h3 className="mb-1 font-semibold text-ink">From journeys to trains</h3>
            <p>Each journey is placed on the stretches it rides, and on the line it changes from where it starts on another line. Rapid Rail is published per day, so the hour-by-hour shape comes from KTM Komuter&apos;s hourly taps in the Klang Valley. Passengers per hour, divided by trains per hour from the timetable, give the load of each train against its 800-person capacity.</p>
          </div>
          <div>
            <h3 className="mb-1 font-semibold text-ink">How sure it is</h3>
            <p>Forecasting each of the last 28 days from the weeks before it, the daily total was within {m.accuracy.mape_pct}% on a typical day. Hour and car figures are less certain than daily ones and are shown as ranges. Komuter riders travel more at peak than LRT riders, so the sharpest peaks may be overstated. Live delays change the picture: a held train leaves the next one fuller, and the twin shows that.</p>
          </div>
        </div>
      </Section>
    </Page>
  );
}
