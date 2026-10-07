"use client";

import { LevelBars } from "@/components/Congestion";
import { LEVEL_META } from "@/lib/levels";
import { useTwin } from "@/lib/store";
import { useUi } from "@/lib/ui";
import type { LineStation } from "@/lib/types";

/** A station lantern: ring coloured by level, bar glyph and name (NET-04, UX-03). */
export function StationMarker({ station, twin, showLabel, onEnter, hidden }: {
  station: LineStation; twin: boolean; showLabel: boolean; onEnter: (id: string) => void; hidden: boolean;
}) {
  const summary = useTwin((s) => s.stations[station.id]);
  const selected = useUi((s) => s.selectedStation === station.id);
  const select = useUi((s) => s.selectStation);
  const level = summary?.level ?? "low";
  const meta = LEVEL_META[level];
  const label = `${station.name}, ${summary ? meta.label : "loading"}${summary?.source === "sim" ? ", simulated" : ", live"}${twin ? ", has a 3D twin" : ""}`;

  if (hidden) return null;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      onClick={(e) => {
        e.stopPropagation();
        select(station.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (twin) onEnter(station.id);
      }}
      className="group relative flex -translate-y-0 items-center"
    >
      <span
        className={`relative block rounded-full border-2 bg-deep ${twin ? "h-4 w-4" : "h-3 w-3"} ${selected ? "ring-2 ring-cyan ring-offset-2 ring-offset-deep" : ""}`}
        style={{ borderColor: `var(--lvl-${level})`, boxShadow: `0 0 ${twin ? 14 : 8}px var(--lvl-${level})` }}
      >
        {level === "crowded" && <span className="absolute inset-[-4px] rounded-full border border-lvl-crowded pulse-slow" />}
      </span>
      <span
        className={`pointer-events-none absolute left-5 top-1/2 flex -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded bg-deep/80 px-1.5 py-0.5 text-xs font-semibold text-ink ${
          showLabel || selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
        }`}
      >
        {station.name}
        <LevelBars level={level} size="sm" />
        {twin && <span className="rounded bg-cyan/20 px-1 text-[9px] uppercase tracking-[0.14em] text-cyan">Twin</span>}
      </span>
    </button>
  );
}
