"use client";

/**
 * The line at a glance (CTRL-01): a control-room diagram of the Kelana Jaya Line with every
 * train on it, both directions, coloured by predicted crowding. Held trains get a red ring,
 * late ones an orange one, closed stretches a hatched track. Tap a train to follow it on the
 * map. Scrolls sideways on phones; the same facts are in "Fullest trains" as a list.
 */

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { blocksAt } from "@/lib/advisor/advisor";
import { crowdOf, crowdVar, pctText } from "@/lib/crowd/levels";
import type { CrowdEngine } from "@/lib/crowd/model";
import { useSimNow } from "@/lib/hooks";
import { NO_DISRUPTIONS, useTwin } from "@/lib/store";
import type { LineData } from "@/lib/types";
import { useUi } from "@/lib/ui";

const STEP = 30;
const PAD = 64; // left: room for the slanted name of the first station
const PAD_R = 24;
const Y = { 0: 34, 1: 74 } as const; // towards Gombak above, towards Putra Heights below
const LATE_S = 120;

export function LineStrip({ engine, line }: { engine: CrowdEngine; line: LineData }) {
  const now = useSimNow(2000);
  const t = now / 1000;
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  const mult = useTwin((s) => s.sim?.scenario.demand_mult ?? 1);
  const selectTrain = useUi((s) => s.selectTrain);
  const router = useRouter();
  const st = line.stations;
  const W = PAD + PAD_R + STEP * (st.length - 1);
  const xOf = useMemo(() => {
    const ds = st.map((s) => s.distance_m);
    return (d: number) => {
      if (d <= ds[0]) return PAD;
      for (let i = 1; i < ds.length; i++) {
        if (d <= ds[i]) return PAD + STEP * (i - 1 + (d - ds[i - 1]) / Math.max(1, ds[i] - ds[i - 1]));
      }
      return PAD + STEP * (ds.length - 1);
    };
  }, [st]);
  const trains = useMemo(() => engine.live(t, disruptions, mult), [engine, t, disruptions, mult]);
  const blocks = useMemo(() => blocksAt(engine, disruptions, t), [engine, disruptions, t]);
  const open = (id: string) => {
    selectTrain(id);
    router.push(`/?train=${encodeURIComponent(id)}`);
  };

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} 150`} style={{ minWidth: W * 0.85 }} className="block w-full" role="img"
          aria-label={`${trains.length} trains on the Kelana Jaya Line, by crowding. ${trains.filter((x) => x.loadPct >= 75).length} crowded or packed.`}>
          <defs>
            <pattern id="strip-closed" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="3" height="6" fill="var(--status-critical)" />
            </pattern>
          </defs>
          <text x={PAD} y={14} fontSize={10.5} fontWeight={700} fill="var(--ink-3)">← Towards {line.directions.find((d) => d.direction_id === 0)?.headsign}</text>
          <text x={W - PAD_R} y={104} fontSize={10.5} fontWeight={700} fill="var(--ink-3)" textAnchor="end">Towards {line.directions.find((d) => d.direction_id === 1)?.headsign} →</text>
          {[0, 1].map((dir) => (
            <line key={dir} x1={PAD} x2={W - PAD_R} y1={Y[dir as 0 | 1]} y2={Y[dir as 0 | 1]} stroke="var(--line-kj)" strokeWidth={4} strokeLinecap="round" opacity={0.85} />
          ))}
          {blocks.map((b, i) => (
            <rect key={i} x={PAD + STEP * b.lo - 4} width={STEP * (b.hi - b.lo) + 8} y={Y[b.dir as 0 | 1] - 5} height={10} rx={3} fill="url(#strip-closed)" />
          ))}
          {st.map((s, i) => (
            <g key={s.id}>
              <circle cx={PAD + STEP * i} cy={Y[0]} r={3.2} fill="white" stroke="var(--ink-2)" strokeWidth={1.2} />
              <circle cx={PAD + STEP * i} cy={Y[1]} r={3.2} fill="white" stroke="var(--ink-2)" strokeWidth={1.2} />
              <text x={PAD + STEP * i} y={116} fontSize={9.5} fill="var(--ink-2)" textAnchor="end" transform={`rotate(-50 ${PAD + STEP * i} 116)`}>{s.name}</text>
            </g>
          ))}
          {trains.map((tr) => {
            const dir = tr.state.directionId as 0 | 1;
            const x = xOf(tr.state.distanceM);
            const y = Y[dir];
            const stops = line.directions.find((d) => d.direction_id === dir)!.stops;
            const k = tr.state.stopIndex;
            const late = tr.run.times[k][0] - (tr.run.trip.start + stops[k].arr) > LATE_S;
            const ring = tr.state.status === "held" ? "var(--status-critical)" : late ? "var(--status-serious)" : "white";
            const c = crowdOf(tr.loadPct);
            const w = 15;
            return (
              <g key={tr.run.trip.id} role="button" tabIndex={0} style={{ cursor: "pointer" }} onClick={() => open(tr.run.trip.id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && open(tr.run.trip.id)}
                aria-label={`Train towards ${line.directions.find((d) => d.direction_id === dir)?.headsign}, ${c.name}, ${pctText(tr.loadPct)}${tr.state.status === "held" ? ", held" : late ? ", late" : ""}`}>
                <title>{`${c.name}, ${pctText(tr.loadPct)}${tr.state.status === "held" ? " · held" : late ? " · late" : ""}`}</title>
                <rect x={x - w / 2} y={y - 6.5} width={w} height={13} rx={dir === 1 ? 6.5 : 3} ry={6.5} fill={crowdVar(c.level)} stroke={ring} strokeWidth={ring === "white" ? 1.5 : 2.6} />
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-rule px-4 py-2 text-[11.5px] text-ink-3">
        <span>Tap a train to follow it on the map.</span>
        <span className="flex items-center gap-1"><span aria-hidden className="h-2.5 w-2.5 rounded-full border-2 border-critical" />Held</span>
        <span className="flex items-center gap-1"><span aria-hidden className="h-2.5 w-2.5 rounded-full border-2 border-serious" />Late 2 min+</span>
        <span className="flex items-center gap-1"><span aria-hidden className="h-2 w-4 rounded-sm" style={{ background: "repeating-linear-gradient(45deg, var(--status-critical) 0 2px, transparent 2px 4px)" }} />Not running</span>
      </div>
    </div>
  );
}
