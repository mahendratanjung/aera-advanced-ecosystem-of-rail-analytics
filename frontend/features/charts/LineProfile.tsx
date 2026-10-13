"use client";

import { useState } from "react";
import { CrowdTag } from "@/components/Crowd";
import { crowdOf } from "@/lib/crowd/levels";
import type { LineData } from "@/lib/types";

/**
 * Load along the line at one moment: one row per stretch, trains towards Gombak to the left of
 * the station names and towards Putra Heights to the right. Bar length is load. Built in HTML
 * so it reflows at phone width; tapping or clicking a row shows both readings in words.
 */
export function LineProfile({ line, loads, label }: { line: LineData; loads: number[][]; label: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const max = Math.max(120, ...loads.flat());
  const bar = (v: number, side: "l" | "r") => (
    <span className={`flex h-3 ${side === "l" ? "justify-end" : ""}`}>
      <span className="h-full rounded-sm" style={{ width: `${(v / max) * 100}%`, background: `var(--crowd-${crowdOf(v).level})` }} />
    </span>
  );
  return (
    <div>
      <p className="mb-2 grid grid-cols-[1fr_96px_1fr] gap-2 text-[11px] font-semibold text-ink-2 sm:grid-cols-[1fr_140px_1fr]">
        <span className="text-right">← Towards Gombak</span><span />
        <span>Towards Putra Heights →</span>
      </p>
      <ol aria-label={label} className="space-y-px">
        {line.stations.slice(0, -1).map((s, i) => {
          const next = line.stations[i + 1];
          const [a, b] = [loads[0][i], loads[1][i]];
          const on = open === i;
          return (
            <li key={s.id}>
              <button type="button" onClick={() => setOpen(on ? null : i)} aria-expanded={on}
                aria-label={`${s.name} to ${next.name}: towards Gombak ${crowdOf(a).name}, towards Putra Heights ${crowdOf(b).name}`}
                className={`grid w-full grid-cols-[1fr_96px_1fr] items-center gap-2 rounded-md px-0.5 py-0.75 text-left sm:grid-cols-[1fr_140px_1fr] ${on ? "bg-surface-2" : "hover:bg-surface-2"}`}>
                {bar(a, "l")}
                <span className="truncate text-center text-[11px] text-ink-2">{s.name}</span>
                {bar(b, "r")}
              </button>
              {on && (
                <p className="flex flex-wrap items-center justify-center gap-2 px-2 pb-1.5 pt-1 text-[12px] text-ink-2">
                  <span className="font-semibold text-ink">{s.name} – {next.name}</span>
                  <span className="flex items-center gap-1">To Gombak <CrowdTag loadPct={a} size="sm" showPct /></span>
                  <span className="flex items-center gap-1">To Putra Heights <CrowdTag loadPct={b} size="sm" showPct /></span>
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
