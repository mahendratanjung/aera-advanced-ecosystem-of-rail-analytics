/** Source and latency badges (UX-07, section 4.2 "the ripple"). */

export function SourceBadge({ source, className = "" }: { source: "device" | "sim" | "mixed"; className?: string }) {
  const live = source === "device";
  const label = live ? "Live" : source === "mixed" ? "Live + Sim" : "Simulated";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[0.12em] ${
        live ? "border-live/50 text-live" : "border-dashed border-sim/50 text-sim"
      } ${className}`}
      title={live ? "Live from a sensor on the scale model" : "Produced by the simulator"}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${live ? "bg-live pulse-slow" : "border border-sim"}`} />
      {label}
    </span>
  );
}

export function LatencyBadge({ ms }: { ms: number | null }) {
  if (ms === null) return null;
  return (
    <span className="tabular rounded bg-sunken px-1.5 py-[1px] text-[10px] text-live" title="Sensor to screen latency">
      {(ms / 1000).toFixed(1)} s
    </span>
  );
}

export function SeverityDot({ severity }: { severity: "high" | "medium" | "low" }) {
  const cls = severity === "high" ? "bg-sev-high" : severity === "medium" ? "bg-sev-medium" : "bg-sev-low";
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
      <span aria-hidden className={`h-2 w-2 rounded-full ${cls}`} />
      {severity}
    </span>
  );
}
