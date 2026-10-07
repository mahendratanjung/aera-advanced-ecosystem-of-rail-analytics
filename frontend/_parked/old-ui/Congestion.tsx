import { LEVEL_META } from "@/lib/levels";
import type { Level } from "@/lib/types";

type L = Level | "nodata";

/** Four-bar glyph. Filled bars follow the level so colour is never the only cue (UX-03). */
export function LevelBars({ level, size = "md" }: { level: L; size?: "sm" | "md" }) {
  const meta = LEVEL_META[level];
  const h = size === "sm" ? [4, 6, 8, 10] : [5, 8, 11, 14];
  return (
    <span aria-hidden className="inline-flex items-end gap-[2px]">
      {h.map((px, i) => (
        <span
          key={i}
          style={{ height: px }}
          className={`w-[3px] rounded-[1px] ${i < meta.bars ? meta.className : "bg-strong-line"} ${level === "nodata" ? "hatch" : ""}`}
        />
      ))}
    </span>
  );
}

export function CongestionPill({ level, estimated = false, percent, size = "md", className = "" }: {
  level: Level; estimated?: boolean; percent?: number; size?: "sm" | "md"; className?: string;
}) {
  const shown: L = estimated ? "nodata" : level;
  const meta = LEVEL_META[shown];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-subtle bg-sunken px-2 ${size === "sm" ? "py-0.5 text-xs" : "py-1 text-sm"} font-medium ${className}`}
    >
      <LevelBars level={shown} size={size} />
      <span className={`${meta.textClass} ${level === "crowded" && !estimated ? "pulse-slow" : ""}`}>{meta.label}</span>
      {percent !== undefined && <span className="tabular text-muted">{Math.round(percent)}%</span>}
      <span className="sr-only">{estimated ? `, estimated, last known ${LEVEL_META[level].label}` : ""}</span>
    </span>
  );
}

export function LevelLegend({ thresholds }: { thresholds?: { moderate: number; busy: number; crowded: number } | null }) {
  const t = thresholds ?? { moderate: 40, busy: 60, crowded: 80 };
  const rows: [L, string][] = [
    ["low", `under ${t.moderate}%`],
    ["moderate", `${t.moderate}–${t.busy}%`],
    ["busy", `${t.busy}–${t.crowded}%`],
    ["crowded", `${t.crowded}%+`],
    ["nodata", "sensor offline"],
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Congestion levels">
      {rows.map(([lvl, range]) => (
        <li key={lvl} className="flex items-center gap-1.5">
          <LevelBars level={lvl} size="sm" />
          <span className="text-ink">{LEVEL_META[lvl].label}</span>
          <span>{range}</span>
        </li>
      ))}
    </ul>
  );
}
