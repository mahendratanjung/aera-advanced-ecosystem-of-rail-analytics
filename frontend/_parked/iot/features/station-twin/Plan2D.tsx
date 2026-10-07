"use client";

/**
 * Flat plan of every level (TWN-10). Used when WebGL is unavailable or by choice, and it
 * reacts to the same state as the 3D scene, including sensor ripples.
 */

import { useMemo } from "react";
import { LEVEL_META } from "@/lib/levels";
import { useTwin } from "@/lib/store";
import type { StationDefinition, TwinState } from "@/lib/types";
import { type Pt, bbox, centroid, stationFrame } from "./geometry";

const PAD = 6;

export function Plan2D({ def, twin, selectedZone, onSelectZone }: {
  def: StationDefinition; twin: TwinState; selectedZone: string | null; onSelectZone: (id: string | null) => void;
}) {
  const frame = useMemo(() => stationFrame(def), [def]);
  const ripples = useTwin((s) => s.ripples);
  const levels = [...def.levels].sort((a, b) => b.elevation - a.elevation);
  const zoneState = Object.fromEntries(twin.zones.map((z) => [z.id, z]));
  const linkState = Object.fromEntries(twin.links.map((l) => [l.id, l]));
  const sensorState = Object.fromEntries(twin.sensors.map((s) => [s.sensor_id, s]));
  const allPts: Pt[] = [...def.zones.flatMap((z) => z.polygon as Pt[]), ...def.tracks.flatMap((t) => [[frame.minX, t.y] as Pt])];
  const b = bbox(allPts);
  const w = b.maxX - b.minX + PAD * 2;
  const h = b.maxY - b.minY + PAD * 2;
  const levelH = h + 6;

  return (
    <svg
      viewBox={`${b.minX - PAD} ${b.minY - PAD - 4} ${w} ${levelH * levels.length}`}
      className="h-full w-full"
      role="group"
      aria-label={`Plan of ${def.name} by level`}
    >
      <defs>
        <pattern id="aera-hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="3" height="3" fill="var(--lvl-nodata)" />
          <line x1="0" y1="0" x2="0" y2="3" stroke="var(--bg-deep)" strokeWidth="1.4" />
        </pattern>
      </defs>
      {levels.map((lv, li) => {
        const oy = li * levelH;
        return (
          <g key={lv.id} transform={`translate(0 ${oy})`}>
            <rect x={b.minX - PAD} y={b.minY - PAD} width={w} height={h} rx={1.5} fill="var(--bg-sunken)" stroke="var(--line-subtle)" strokeWidth={0.2} />
            <text x={b.minX - PAD + 1} y={b.minY - PAD - 1} fontSize={2.6} fill="var(--text-muted)" fontWeight={600} letterSpacing={0.3}>
              {lv.id} · {lv.name.toUpperCase()}
            </text>
            {def.tracks.filter((t) => t.level === lv.id).map((t) => (
              <line key={t.direction_id} x1={b.minX - PAD} x2={b.maxX + PAD} y1={t.y} y2={t.y} stroke="var(--brand-cyan)" strokeWidth={0.5} opacity={0.7} />
            ))}
            {def.zones.filter((z) => z.level === lv.id).map((z) => {
              const st = zoneState[z.id];
              const shaded = !st || !st.available || st.estimated;
              const [cx, cy] = centroid(z.polygon as Pt[]);
              const meta = LEVEL_META[shaded ? "nodata" : st.level];
              const label = `${z.name}: ${st ? `${meta.label}, ${st.count} of ${st.capacity}` : "loading"}${st && !st.available ? `, closed: ${st.reason}` : ""}`;
              return (
                <g
                  key={z.id}
                  role="button"
                  tabIndex={0}
                  aria-label={label}
                  aria-pressed={selectedZone === z.id}
                  onClick={() => onSelectZone(z.id)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelectZone(z.id)}
                  className="cursor-pointer focus:outline-none"
                >
                  <polygon
                    points={z.polygon.map((p) => p.join(",")).join(" ")}
                    fill={shaded ? "url(#aera-hatch)" : `var(--lvl-${st.level})`}
                    fillOpacity={shaded ? 1 : 0.78}
                    stroke={selectedZone === z.id ? "var(--brand-cyan)" : "var(--bg-deep)"}
                    strokeWidth={selectedZone === z.id ? 0.8 : 0.3}
                    style={{ transition: "fill var(--motion-zone) var(--ease-inout)" }}
                  />
                  <text x={cx} y={cy - 0.6} textAnchor="middle" fontSize={2.4} fontWeight={700} fill="var(--lvl-ink)">{z.name}</text>
                  {st && (
                    <text x={cx} y={cy + 2.4} textAnchor="middle" fontSize={2.1} fill="var(--lvl-ink)" className="tabular">
                      {st.count}/{st.capacity} · {meta.label}
                    </text>
                  )}
                </g>
              );
            })}
            {def.links.map((lk) => {
              const level = lk.level ?? (lk.from === "outside" ? frame.zoneLevel[lk.to] : frame.zoneLevel[lk.from]);
              if (level !== lv.id) return null;
              const ok = linkState[lk.id]?.available !== false;
              return (
                <g key={lk.id}>
                  <rect x={lk.position[0] - 0.7} y={lk.position[1] - 1.6} width={1.4} height={3.2} rx={0.3}
                    fill={ok ? "var(--brand-mist)" : "var(--lvl-crowded)"} />
                  <title>{`${lk.name ?? lk.id}${ok ? "" : " (out of service)"}`}</title>
                </g>
              );
            })}
            {def.sensors.map((s) => {
              const lk = s.link ? def.links.find((l) => l.id === s.link) : null;
              const level = lk ? (lk.level ?? frame.zoneLevel[lk.from] ?? frame.zoneLevel[lk.to]) : s.zone ? frame.zoneLevel[s.zone] : null;
              if (level !== lv.id || s.kind !== "crossing" || !lk) return null;
              const state = sensorState[s.sensor_id]?.state ?? "offline";
              const [x, y] = lk.position;
              const recent = ripples.filter((r) => r.sensor_id === s.sensor_id && r.station_id === twin.station_id && Date.now() - r.at < 1200);
              const colour = state === "live" ? "var(--state-live)" : state === "sim" ? "var(--state-sim)" : "var(--state-offline)";
              return (
                <g key={s.sensor_id}>
                  {recent.map((r) => (
                    <circle key={r.key} cx={x} cy={y - 3} r={1.4} fill="none" stroke={colour} strokeWidth={0.4} className="ripple"
                      style={{ transformBox: "fill-box", transformOrigin: "center" }} />
                  ))}
                  <circle cx={x} cy={y - 3} r={0.9} fill={colour} />
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
