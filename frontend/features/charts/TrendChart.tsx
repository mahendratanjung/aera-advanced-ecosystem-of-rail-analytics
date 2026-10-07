"use client";

import { useMemo, useRef } from "react";
import { TooltipBox, useTip } from "./Tooltip";

const W = 720;
const H = 220;
const L = 44;
const B = 22;
const T = 10;

/** Daily journeys on the line with a 7-day average. One axis, two series, legend above. */
export function TrendChart({ start, daily }: { start: string; daily: number[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const { tip, show, hide } = useTip();
  const t0 = Date.parse(`${start}T00:00:00Z`);
  const avg = useMemo(() => daily.map((_, i) => {
    const s = daily.slice(Math.max(0, i - 6), i + 1);
    return s.reduce((a, b) => a + b, 0) / s.length;
  }), [daily]);
  const max = Math.ceil(Math.max(...daily) / 50000) * 50000;
  const x = (i: number) => L + (i / (daily.length - 1)) * (W - L - 8);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const months: { i: number; label: string }[] = [];
  daily.forEach((_, i) => {
    const d = new Date(t0 + i * 86400000);
    if (d.getUTCDate() === 1 && d.getUTCMonth() % 3 === 0) {
      months.push({ i, label: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }) });
    }
  });
  const fmtDate = (i: number) => new Date(t0 + i * 86400000).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

  return (
    <div>
      <div className="mb-2 flex gap-4 text-xs text-ink-2">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-rule-strong" />Each day</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-accent" />7-day average</span>
      </div>
      <div ref={ref} className="relative" onMouseLeave={hide}
        onMouseMove={(e) => {
          const box = ref.current!.getBoundingClientRect();
          const sx = ((e.clientX - box.left) / box.width) * W;
          const i = Math.round(((sx - L) / (W - L - 8)) * (daily.length - 1));
          if (i < 0 || i >= daily.length) return hide();
          show({ x: (x(i) / W) * box.width, y: (y(Math.max(daily[i], avg[i])) / H) * box.height, title: fmtDate(i),
            lines: [`${daily[i].toLocaleString("en-GB")} journeys`, `7-day average ${Math.round(avg[i]).toLocaleString("en-GB")}`] });
        }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Daily journeys on the Kelana Jaya Line">
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={L} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="var(--rule)" />
              <text x={L - 6} y={y(max * f) + 3} textAnchor="end" fontSize={10} fill="var(--ink-3)" className="num">{Math.round((max * f) / 1000)}k</text>
            </g>
          ))}
          {months.map((m) => (
            <text key={m.i} x={x(m.i)} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--ink-3)">{m.label}</text>
          ))}
          <path d={path(daily)} fill="none" stroke="var(--rule-strong)" strokeWidth={1} />
          <path d={path(avg)} fill="none" stroke="var(--accent)" strokeWidth={2} />
          {tip && (() => {
            const i = Math.round(((tip.x / (ref.current?.clientWidth ?? W)) * W - L) / (W - L - 8) * (daily.length - 1));
            return i >= 0 && i < daily.length ? <line x1={x(i)} x2={x(i)} y1={T} y2={H - B} stroke="var(--ink-3)" strokeDasharray="2 2" /> : null;
          })()}
        </svg>
        <TooltipBox tip={tip} width={ref.current?.clientWidth ?? 600} />
      </div>
    </div>
  );
}
