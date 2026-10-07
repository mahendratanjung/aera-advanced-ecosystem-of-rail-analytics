"use client";

import { useRef } from "react";
import { pctText, crowdOf } from "@/lib/crowd/levels";
import type { LineData } from "@/lib/types";
import { TooltipBox, useTip } from "./Tooltip";

/**
 * Load along the line at one moment: each segment as a row, trains towards Gombak to the
 * left of the spine and towards Putra Heights to the right. Bar length is load.
 */
export function LineProfile({ line, loads, label }: { line: LineData; loads: number[][]; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { tip, show, hide } = useTip();
  const ROW = 15;
  const W = 640;
  const MID = W / 2;
  const NAME = 112;
  const n = line.stations.length - 1;
  const H = n * ROW + 24;
  const max = Math.max(120, ...loads.flat());
  const half = MID - NAME / 2 - 6;
  const len = (v: number) => (v / max) * half;
  return (
    <div ref={ref} className="relative" onMouseLeave={hide}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={label}>
        <text x={MID - NAME / 2 - 6} y={10} textAnchor="end" fontSize={11} fill="var(--ink-2)">← Towards Gombak</text>
        <text x={MID + NAME / 2 + 6} y={10} fontSize={11} fill="var(--ink-2)">Towards Putra Heights →</text>
        {[50, 100].map((g) => (
          <g key={g}>
            <line x1={MID - NAME / 2 - 6 - len(g)} x2={MID - NAME / 2 - 6 - len(g)} y1={18} y2={H} stroke="var(--rule)" strokeDasharray="3 3" />
            <line x1={MID + NAME / 2 + 6 + len(g)} x2={MID + NAME / 2 + 6 + len(g)} y1={18} y2={H} stroke="var(--rule)" strokeDasharray="3 3" />
          </g>
        ))}
        {line.stations.slice(0, -1).map((s, i) => {
          const y = 20 + i * ROW;
          const a = loads[0][i];
          const b = loads[1][i];
          const next = line.stations[i + 1];
          return (
            <g key={s.id}
              onMouseEnter={() => {
                const box = ref.current?.getBoundingClientRect();
                if (!box) return;
                show({ x: box.width / 2, y: (y / H) * box.height, title: `${s.name} – ${next.name}`,
                  lines: [`To Gombak: ${crowdOf(a).name}, ${pctText(a)}`, `To Putra Heights: ${crowdOf(b).name}, ${pctText(b)}`] });
              }}>
              <rect x={0} y={y} width={W} height={ROW} fill="transparent" />
              <rect x={MID - NAME / 2 - 6 - len(a)} y={y + 2} width={len(a)} height={ROW - 4} rx={2} fill={`var(--crowd-${crowdOf(a).level})`} />
              <rect x={MID + NAME / 2 + 6} y={y + 2} width={len(b)} height={ROW - 4} rx={2} fill={`var(--crowd-${crowdOf(b).level})`} />
              <text x={MID} y={y + ROW / 2 + 3.5} textAnchor="middle" fontSize={10} fill="var(--ink-2)">{s.name.length > 16 ? `${s.name.slice(0, 15)}…` : s.name}</text>
            </g>
          );
        })}
      </svg>
      <TooltipBox tip={tip} width={ref.current?.clientWidth ?? 600} />
    </div>
  );
}
