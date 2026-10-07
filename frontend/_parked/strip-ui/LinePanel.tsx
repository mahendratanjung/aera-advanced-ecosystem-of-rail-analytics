"use client";

import { ArrowRight, ChartLineUp, Train } from "@phosphor-icons/react/dist/ssr";
import { useEffect, useState } from "react";
import { CrowdScale, CrowdTag } from "@/components/Crowd";
import { ServiceNotices } from "@/components/Notice";
import { subscribe } from "@/lib/crowd/feed";
import { crowdOf } from "@/lib/crowd/levels";
import type { CrowdEngine } from "@/lib/crowd/model";
import type { LineData } from "@/lib/types";

interface Summary {
  running: number;
  avg: number;
  busiest: { dir: number; from: string; to: string; load: number }[];
}

/** Where it is crowded now, before the rider picks a station. */
export function LinePanel({ engine, line, onPickStation }: { engine: CrowdEngine; line: LineData; onPickStation: (id: string) => void }) {
  const [sum, setSum] = useState<Summary | null>(null);
  useEffect(() => {
    let last = 0;
    return subscribe((f) => {
      if (performance.now() - last < 2000) return;
      last = performance.now();
      const ranked = [...f.trains].sort((a, b) => b.loadPct - a.loadPct);
      const seen = new Set<string>();
      const busiest: Summary["busiest"] = [];
      for (const tr of ranked) {
        const dir = tr.run.trip.directionId;
        const stops = line.directions.find((d) => d.direction_id === dir)!.stops;
        const k = Math.min(tr.state.stopIndex, stops.length - 2);
        const key = `${dir}-${k}`;
        if (seen.has(key)) continue;
        seen.add(key);
        busiest.push({ dir, from: stops[k].station_id, to: stops[k + 1].station_id, load: tr.loadPct });
        if (busiest.length === 3) break;
      }
      setSum({ running: f.trains.length, avg: f.trains.reduce((a, b) => a + b.loadPct, 0) / Math.max(1, f.trains.length), busiest });
    });
  }, [line]);
  const names = Object.fromEntries(line.stations.map((s) => [s.id, s.name]));
  const heads = Object.fromEntries(line.directions.map((d) => [d.direction_id, d.headsign]));
  const m = engine.data;

  return (
    <div className="space-y-5">
      <header>
        <p className="flex items-center gap-2 text-sm font-semibold text-line"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-line" />Kelana Jaya Line</p>
        <h2 className="mt-1 text-[28px] font-extrabold tracking-tight text-ink">Right now</h2>
      </header>
      {sum && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-card bg-accent-soft p-4">
            <Train size={20} weight="fill" className="text-accent" aria-hidden />
            <p className="num mt-2 text-[28px] font-extrabold leading-none text-ink">{sum.running}</p>
            <p className="mt-1 text-xs font-medium text-ink-2">trains running</p>
          </div>
          <div className="rounded-card p-4" style={{ background: `var(--crowd-${crowdOf(sum.avg).level}-soft)` }}>
            <ChartLineUp size={20} weight="fill" style={{ color: `var(--crowd-${crowdOf(sum.avg).level}-ink)` }} aria-hidden />
            <p className="num mt-2 text-[28px] font-extrabold leading-none text-ink">{Math.round(sum.avg)}%</p>
            <p className="mt-1 text-xs font-medium text-ink-2">average load</p>
          </div>
        </div>
      )}
      {sum?.running === 0 && <p className="text-sm text-ink-2">No trains are running. Service starts around 06:00.</p>}
      <ServiceNotices />
      {sum && sum.busiest.length > 0 && (
        <section aria-label="Most crowded trains now" className="card overflow-hidden">
          <h3 className="px-4 pb-1 pt-4 text-[15px] font-bold text-ink">Most crowded now</h3>
          <ol>
            {sum.busiest.map((b) => (
              <li key={`${b.dir}-${b.from}`}>
                <button type="button" onClick={() => onPickStation(b.from)} className="pressable flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{names[b.from]} → {names[b.to]}</span>
                    <span className="block text-xs text-ink-3">To {heads[b.dir]}</span>
                  </span>
                  <CrowdTag loadPct={b.load} size="sm" />
                  <ArrowRight size={16} className="text-ink-3" aria-hidden />
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
      <section aria-label="Crowding levels" className="card p-4">
        <h3 className="mb-3 text-[15px] font-bold text-ink">How full trains are</h3>
        <CrowdScale />
      </section>
      <p className="text-xs leading-relaxed text-ink-3">
        Predicted from {m.window.weeks} weeks of gate taps ({m.window.from} to {m.window.to}) published on data.gov.my.
        In back-testing, daily totals were within {m.accuracy.mape_pct}% on a typical day.
      </p>
    </div>
  );
}
