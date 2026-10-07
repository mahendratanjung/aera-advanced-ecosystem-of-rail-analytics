import { minutesUntil, klTime } from "@/lib/format";
import type { Departure } from "@/lib/sim/trains";

/** One upcoming train (PAX-02, PAX-03). Times come from the simulated timetable. */
export function NextTrainRow({ dep, nowMs }: { dep: Departure; nowMs: number }) {
  const mins = minutesUntil(dep.arrival, nowMs);
  const late = dep.delayS >= 60;
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="truncate font-semibold text-ink">To {dep.headsign}</p>
        <p className="text-xs text-muted">
          {dep.atPlatform ? "At platform" : klTime(dep.arrival * 1000)}
          {late && <span className="text-lvl-busy"> · {Math.round(dep.delayS / 60)} min late</span>}
          <span> · load {Math.round(dep.loadPct)}%</span>
        </p>
      </div>
      <p className="tabular shrink-0 text-right text-2xl font-medium text-ink" aria-label={dep.atPlatform ? "now" : `${mins} minutes`}>
        {dep.atPlatform || mins === 0 ? <span className="text-base font-semibold text-cyan">Now</span> : <>{mins}<span className="ml-0.5 text-xs text-muted">min</span></>}
      </p>
    </li>
  );
}
