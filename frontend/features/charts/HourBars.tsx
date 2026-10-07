"use client";

import { useRef } from "react";
import { pctText, crowdOf } from "@/lib/crowd/levels";
import { TooltipBox, useTip } from "./Tooltip";

const H = 132;
const PAD_L = 30;
const PAD_B = 20;
const PAD_T = 10;

/** Typical load of a train by hour, bars shaded by Crowding level, with "now" marked. */
export function HourBars({ values, nowHour, label, from = 5 }: { values: (number | null)[]; nowHour?: number; label: string; from?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { tip, show, hide } = useTip();
  const hours = Array.from({ length: 24 - from + 1 }, (_, i) => (from + i) % 24);
  const W = 440;
  const max = Math.max(110, ...values.map((v) => v ?? 0));
  const bw = (W - PAD_L) / hours.length;
  const y = (v: number) => PAD_T + (H - PAD_T - PAD_B) * (1 - v / max);
  const gridlines = [50, 100];
  return (
    <div ref={ref} className="relative" onMouseLeave={hide}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={label}>
        {gridlines.map((g) => (
          <g key={g}>
            <line x1={PAD_L} x2={W} y1={y(g)} y2={y(g)} stroke="var(--rule)" strokeDasharray={g === 100 ? "0" : "3 3"} />
            <text x={PAD_L - 6} y={y(g) + 3} textAnchor="end" fontSize={11} fill="var(--ink-3)" className="num">{g}%</text>
          </g>
        ))}
        {hours.map((h, i) => {
          const v = values[h];
          const x = PAD_L + i * bw;
          const isNow = nowHour !== undefined && Math.floor(nowHour) === h;
          return (
            <g key={h}>
              {v !== null && v > 0 && (
                <path
                  d={`M${x + 1} ${y(0)} V${y(v) + 3} Q${x + 1} ${y(v)} ${x + 4} ${y(v)} H${x + bw - 4} Q${x + bw - 1} ${y(v)} ${x + bw - 1} ${y(v) + 3} V${y(0)} Z`}
                  fill={`var(--crowd-${crowdOf(v).level})`} />
              )}
              {isNow && <rect x={x} y={PAD_T - 6} width={bw} height={H - PAD_T - PAD_B + 6} fill="none" stroke="var(--ink)" strokeWidth={1.2} rx={2} />}
              {(h % 3 === 0 || isNow) && (
                <text x={x + bw / 2} y={H - 5} textAnchor="middle" fontSize={11} fill={isNow ? "var(--ink)" : "var(--ink-3)"} fontWeight={isNow ? 600 : 400} className="num">
                  {isNow ? "Now" : String(h).padStart(2, "0")}
                </text>
              )}
              <rect x={x} y={0} width={bw} height={H} fill="transparent"
                onMouseEnter={() => {
                  const box = ref.current?.getBoundingClientRect();
                  if (!box) return;
                  const px = ((x + bw / 2) / W) * box.width;
                  show({ x: px, y: ((v !== null ? y(v) : y(0)) / H) * box.height,
                    title: `${String(h).padStart(2, "0")}:00 to ${String((h + 1) % 24).padStart(2, "0")}:00`,
                    lines: v === null ? ["No trains"] : [`${crowdOf(v).name}, ${pctText(v)}`] });
                }} />
            </g>
          );
        })}
        <line x1={PAD_L} x2={W} y1={y(0)} y2={y(0)} stroke="var(--rule-strong)" />
      </svg>
      <TooltipBox tip={tip} width={ref.current?.clientWidth ?? 400} />
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>{hours.map((h) => <tr key={h}><th>{h}:00</th><td>{values[h] === null ? "no trains" : `${Math.round(values[h]!)}%`}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
