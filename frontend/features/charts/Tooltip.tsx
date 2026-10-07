"use client";

import { useState } from "react";

export interface Tip {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

/** Hover layer shared by the charts. Position is in the chart container's pixels. */
export function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  return { tip, show: setTip, hide: () => setTip(null) };
}

export function TooltipBox({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x, 70), width - 70);
  return (
    <div role="status" className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-sign border border-rule bg-surface px-2.5 py-1.5 text-xs shadow-[0_4px_16px_rgba(15,27,45,0.12)]"
      style={{ left, top: tip.y - 8 }}>
      <p className="font-semibold text-ink">{tip.title}</p>
      {tip.lines.map((l) => <p key={l} className="whitespace-nowrap text-ink-2">{l}</p>)}
    </div>
  );
}
