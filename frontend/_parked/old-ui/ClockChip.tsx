"use client";

import { klDate, klTime } from "@/lib/format";
import { useSimNow } from "@/lib/hooks";
import { useTwin } from "@/lib/store";

/** Simulation clock in Kuala Lumpur time (SIM-03). Always labelled as simulated. */
export function ClockChip({ className = "" }: { className?: string }) {
  const now = useSimNow(1000);
  const sim = useTwin((s) => s.sim);
  if (!sim) return null;
  const { speed, paused } = sim.clock;
  return (
    <div className={`panel flex items-center gap-3 px-3 py-2 ${className}`} aria-live="off">
      <div>
        <p className="eyebrow">Simulated clock · KL</p>
        <p className="tabular text-xl font-medium leading-tight text-ink">{klTime(now, true)}</p>
      </div>
      <div className="border-l border-subtle pl-3 text-xs text-muted">
        <p>{klDate(now)}</p>
        <p className="tabular">
          {paused ? "Paused" : speed === 1 ? "Real time" : `×${speed}`}
          {sim.scenario.id !== "normal" && <span className="text-cyan"> · {sim.scenario.name}</span>}
        </p>
      </div>
    </div>
  );
}
