"use client";

import { useRef } from "react";
import { pctText, crowdOf } from "@/lib/crowd/levels";
import { useMediaQuery } from "@/lib/hooks";
import { TooltipBox, useTip } from "./Tooltip";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FIRST = 5;

/**
 * Weekday by hour: when a stretch of line is crowded. Cells use the crowding scale. On phones
 * the grid turns on its side (hours down, days across) so the text stays readable, and a tap
 * shows a cell the way a hover does on desktop.
 */
export function WeekHeatmap({ grid, label, now }: { grid: (number | null)[][]; label: string; now?: { day: number; hour: number } }) {
  const ref = useRef<HTMLDivElement>(null);
  const { tip, show, hide } = useTip();
  const tall = useMediaQuery("(max-width: 639px)");
  const hours = Array.from({ length: 24 - FIRST }, (_, i) => FIRST + i);
  const [CW, CH, L, T] = tall ? [36, 19, 36, 20] : [26, 22, 40, 4];
  const W = tall ? L + 7 * CW : L + hours.length * CW;
  const H = tall ? T + hours.length * CH + 4 : T + 7 * CH + 20;
  const cell = (d: number, i: number) => (tall ? { x: L + d * CW, y: T + i * CH } : { x: L + i * CW, y: T + d * CH });

  return (
    <div ref={ref} className="relative" onMouseLeave={hide}>
      <svg viewBox={`0 0 ${W} ${H}`} className={tall ? "mx-auto w-full max-w-90" : "w-full"} role="img" aria-label={label}>
        {grid.map((row, d) => (
          <g key={d}>
            {tall
              ? <text x={L + d * CW + CW / 2} y={T - 7} textAnchor="middle" fontSize={11} fill="var(--ink-2)">{DAYS[d]}</text>
              : <text x={L - 8} y={T + d * CH + CH / 2 + 4} textAnchor="end" fontSize={11} fill="var(--ink-2)">{DAYS[d]}</text>}
            {hours.map((h, i) => {
              const v = row[h];
              const isNow = now && now.day === d && now.hour === h;
              const { x, y } = cell(d, i);
              const reveal = () => {
                const box = ref.current?.getBoundingClientRect();
                if (!box) return;
                show({ x: ((x + CW / 2) / W) * box.width, y: (y / H) * box.height,
                  title: `${DAYS[d]} ${String(h).padStart(2, "0")}:00`,
                  lines: v === null ? ["No trains"] : [`${crowdOf(v).name}, ${pctText(v)}`] });
              };
              return (
                <rect key={h} x={x + 1} y={y + 1} width={CW - 2} height={CH - 2} rx={2}
                  fill={v === null ? "var(--crowd-empty)" : `var(--crowd-${crowdOf(v).level})`}
                  stroke={isNow ? "var(--ink)" : "none"} strokeWidth={isNow ? 2 : 0}
                  onMouseEnter={reveal} onClick={reveal} />
              );
            })}
          </g>
        ))}
        {hours.filter((h) => h % (tall ? 2 : 3) === 0).map((h) => {
          const i = h - FIRST;
          return tall
            ? <text key={h} x={L - 6} y={T + i * CH + CH / 2 + 4} textAnchor="end" fontSize={11} fill="var(--ink-3)" className="num">{String(h).padStart(2, "0")}</text>
            : <text key={h} x={L + i * CW + CW / 2} y={H - 4} textAnchor="middle" fontSize={10} fill="var(--ink-3)" className="num">{String(h).padStart(2, "0")}</text>;
        })}
      </svg>
      <TooltipBox tip={tip} width={ref.current?.clientWidth ?? 500} />
      <div className="sr-only"><table>
        <caption>{label}</caption>
        <tbody>
          {grid.map((row, d) => (
            <tr key={d}><th>{DAYS[d]}</th>{hours.map((h) => <td key={h}>{row[h] === null ? "-" : `${h}:00 ${Math.round(row[h]!)}%`}</td>)}</tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}
