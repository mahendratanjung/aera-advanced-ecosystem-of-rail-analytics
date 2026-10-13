import type { LineDef } from "@/lib/network/schematic";

/** The poster's numbered circle for a line, in the line's colour. */
export function LineBadge({ line, size = 24, className = "" }: { line: Pick<LineDef, "badge" | "color" | "inkBadge" | "name">; size?: number; className?: string }) {
  return (
    <span aria-label={line.name} title={line.name}
      className={`num inline-flex shrink-0 items-center justify-center rounded-full font-extrabold leading-none ${className}`}
      style={{ width: size, height: size, fontSize: size * (line.badge.length > 1 ? 0.42 : 0.5), background: `var(${line.color})`, color: line.inkBadge ? "var(--ink)" : "#fff" }}>
      {line.badge}
    </span>
  );
}

const DATA_TEXT = { live: "Live crowding", timetable: "Timetable", estimate: "Estimated", suspended: "Suspended" } as const;

/** What AERA knows about a line, as a small chip. */
export function DataChip({ data }: { data: LineDef["data"] }) {
  const cls = data === "live" ? "bg-accent-soft text-accent" : data === "suspended" ? "bg-critical/5 text-critical" : data === "timetable" ? "bg-surface-2 text-ink-2" : "bg-surface-2 text-ink-3";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {data === "live" && <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
      {DATA_TEXT[data]}
    </span>
  );
}
