"use client";

import { useRef } from "react";
import { pctText, crowdOf } from "@/lib/crowd/levels";
import { TooltipBox, useTip } from "./Tooltip";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FIRST = 5;

/** Weekday by hour: when a stretch of line is crowded. Cells use the crowding scale. */
export function WeekHeatmap({ grid, label, now }: { grid: (number | null)[][]; label: string; now?: { day: number; hour: number } }) {
  const ref = useRef<HTMLDivElement>(null);
  const { tip, show, hide } = useTip();
  const hours = Array.from({ length: 24 - FIRST }, (_, i) => FIRST + i);
  const CW = 26;
  const CH = 22;
  const L = 40;
  const T = 4;
  const W = L + hours.length * CW;
  const H = T + 7 * CH + 20;
  return (
    <div ref={ref} className="relative" onMouseLeave={hide}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={label}>
        {grid.map((row, d) => (
          <g key={d}>
            <text x={L - 8} y={T + d * CH + CH / 2 + 4} textAnchor="end" fontSize={11} fill="var(--ink-2)">{DAYS[d]}</text>
            {hours.map((h, i) => {
              const v = row[h];
              const isNow = now && now.day === d && now.hour === h;
              return (
                <rect key={h} x={L + i * CW + 1} y={T + d * CH + 1} width={CW - 2} height={CH - 2} rx={2}
                  fill={v === null ? "var(--crowd-empty)" : `var(--crowd-${crowdOf(v).level})`}
                  stroke={isNow ? "var(--ink)" : "none"} strokeWidth={isNow ? 2 : 0}
                  onMouseEnter={() => {
                    const box = ref.current?.getBoundingClientRect();
                    if (!box) return;
                    show({ x: ((L + i * CW + CW / 2) / W) * box.width, y: ((T + d * CH) / H) * box.height,
                      title: `${DAYS[d]} ${String(h).padStart(2, "0")}:00`,
                      lines: v === null ? ["No trains"] : [`${crowdOf(v).name}, ${pctText(v)}`] });
                  }} />
              );
            })}
          </g>
        ))}
        {hours.filter((h) => h % 3 === 0).map((h) => (
          <text key={h} x={L + (h - FIRST) * CW + CW / 2} y={H - 4} textAnchor="middle" fontSize={10} fill="var(--ink-3)" className="num">
            {String(h).padStart(2, "0")}
          </text>
        ))}
      </svg>
      <TooltipBox tip={tip} width={ref.current?.clientWidth ?? 500} />
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {grid.map((row, d) => (
            <tr key={d}><th>{DAYS[d]}</th>{hours.map((h) => <td key={h}>{row[h] === null ? "-" : `${h}:00 ${Math.round(row[h]!)}%`}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
