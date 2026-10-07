"use client";

/**
 * The live strip map: the line diagram above the train doors, made live. Two tracks run
 * down the page (left towards Gombak, right towards Putra Heights). Each stretch of track is
 * shaded by the load of the last train through it, and every train is drawn as four cars
 * shaded by their own predicted load. Positions update every frame from the shared feed.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Interchanges, StationCode } from "@/components/StationCode";
import { pctText, crowdOf } from "@/lib/crowd/levels";
import { type LiveFrame, subscribe } from "@/lib/crowd/feed";
import type { CrowdEngine } from "@/lib/crowd/model";
import { useTwin } from "@/lib/store";
import type { LineData } from "@/lib/types";

const ROW = 40;
const TOP = 20;
const LANE = [24, 48]; // x centre of the track for direction 0 and 1
const LANE_W = 8;
const TRAIN_H = 30;
const TRAIN_W = 14;

function yForDistance(line: LineData, distance: number): number {
  const st = line.stations;
  if (distance <= st[0].distance_m) return TOP;
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i].distance_m;
    const b = st[i + 1].distance_m;
    if (distance <= b) return TOP + (i + (distance - a) / Math.max(1, b - a)) * ROW;
  }
  return TOP + (st.length - 1) * ROW;
}

/** Load of the last train to leave each segment, per direction, in station order. */
function segmentLoads(engine: CrowdEngine, frame: LiveFrame, nSeg: number): number[][] {
  const out = [0, 1].map(() => new Array<number>(nSeg).fill(NaN));
  const when = [0, 1].map(() => new Array<number>(nSeg).fill(-Infinity));
  for (const tr of frame.trains) {
    const dir = tr.run.trip.directionId;
    for (let k = 0; k < tr.run.legs.length; k++) {
      const dep = tr.run.times[k][1];
      if (dep > frame.t) break;
      const seg = engine.segment(dir, k);
      if (dep > when[dir][seg]) {
        when[dir][seg] = dep;
        out[dir][seg] = tr.run.legs[k];
      }
    }
  }
  for (const dir of [0, 1]) {
    for (let k = 0; k < nSeg; k++) {
      if (Number.isNaN(out[dir][engine.segment(dir, k)])) {
        out[dir][engine.segment(dir, k)] = engine.typicalLegLoad(dir, k, frame.t);
      }
    }
  }
  return out;
}

export function StripMap({ line, engine, selected, onSelect, selectedTrain, onSelectTrain }: {
  line: LineData; engine: CrowdEngine; selected: string | null; onSelect: (id: string) => void;
  selectedTrain: string | null; onSelectTrain: (tripId: string) => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLButtonElement>());
  const [loads, setLoads] = useState<number[][] | null>(null);
  const disruptions = useTwin((s) => s.sim?.disruptions);
  const n = line.stations.length;
  const height = TOP * 2 + (n - 1) * ROW;
  const names = useMemo(() => Object.fromEntries(line.stations.map((s) => [s.id, s.name])), [line]);
  const selectedTrainRef = useRef(selectedTrain);
  selectedTrainRef.current = selectedTrain;
  const onSelectTrainRef = useRef(onSelectTrain);
  onSelectTrainRef.current = onSelectTrain;

  useEffect(() => {
    let lastLoads = 0;
    return subscribe((frame) => {
      const el = layer.current;
      if (!el) return;
      const seen = new Set<string>();
      for (const tr of frame.trains) {
        const id = tr.run.trip.id;
        seen.add(id);
        let node = nodes.current.get(id);
        const dir = tr.run.trip.directionId;
        if (!node) {
          node = document.createElement("button");
          node.type = "button";
          node.className = "absolute left-0 top-0 flex flex-col gap-[2px] rounded-[6px] p-[2px] outline-offset-1 transition-shadow";
          node.style.width = `${TRAIN_W}px`;
          node.style.height = `${TRAIN_H}px`;
          node.style.background = "var(--surface)";
          for (let c = 0; c < 4; c++) {
            const car = document.createElement("span");
            car.className = "block flex-1 rounded-[2px]";
            node.appendChild(car);
          }
          node.addEventListener("click", (e) => {
            e.stopPropagation();
            onSelectTrainRef.current(id);
          });
          el.appendChild(node);
          nodes.current.set(id, node);
        }
        const y = yForDistance(line, tr.state.distanceM);
        node.style.transform = `translate(${LANE[dir] - TRAIN_W / 2}px, ${y - TRAIN_H / 2}px)`;
        const cars = engine.carLoads(tr.loadPct, dir);
        // Car 1 is the front: at the top when heading to Gombak, at the bottom otherwise.
        const order = dir === 0 ? cars : [...cars].reverse();
        order.forEach((c, i) => {
          (node!.children[i] as HTMLElement).style.background = `var(--crowd-${crowdOf(c).level})`;
        });
        const held = tr.state.status === "held";
        const sel = selectedTrainRef.current === id;
        node.style.boxShadow = sel
          ? "0 0 0 2px var(--surface), 0 0 0 4px var(--accent), 0 4px 10px rgba(16,24,40,.25)"
          : held ? "0 0 0 2px var(--status-critical), 0 2px 6px rgba(16,24,40,.2)" : "0 0 0 1px rgba(14,23,38,.18), 0 2px 6px rgba(16,24,40,.18)";
        const s = crowdOf(tr.loadPct);
        const near = names[line.directions.find((d) => d.direction_id === dir)!.stops[tr.state.stopIndex].station_id];
        node.setAttribute("aria-label", `Train to ${dir === 0 ? "Gombak" : "Putra Heights"}, ${s.name}, ${pctText(tr.loadPct)}, ${tr.state.status === "moving" ? "leaving" : "at"} ${near}${held ? ", held" : ""}`);
      }
      for (const [id, node] of nodes.current) {
        if (!seen.has(id)) {
          node.remove();
          nodes.current.delete(id);
        }
      }
      if (performance.now() - lastLoads > 2000) {
        lastLoads = performance.now();
        setLoads(segmentLoads(engine, frame, n - 1));
      }
    });
  }, [engine, line, n, names]);

  const suspended = (disruptions ?? []).filter((d) => d.kind === "suspend" && d.to_stop_id);
  const marked = new Map<string, "hold" | "delay" | "surge">();
  for (const d of disruptions ?? []) if (d.kind !== "suspend") marked.set(d.stop_id, d.kind);
  const rowOf = (id: string) => line.stations.findIndex((s) => s.id === id);

  return (
    <div className="relative select-none" style={{ height }}>
      <svg className="absolute inset-0 h-full w-full" aria-hidden>
        {loads && [0, 1].map((dir) =>
          line.stations.slice(0, -1).map((s, i) => {
            const pct = loads[dir][i];
            const lv = crowdOf(pct);
            return (
              <rect key={`${dir}-${i}`} x={LANE[dir] - LANE_W / 2} y={TOP + i * ROW + 3} width={LANE_W} height={ROW - 6} rx={LANE_W / 2}
                fill={`var(--crowd-${lv.level})`}>
                <title>{`${s.name} to ${line.stations[i + 1].name}, towards ${dir === 0 ? "Gombak" : "Putra Heights"}: ${lv.name}, ${pctText(pct)}`}</title>
              </rect>
            );
          }),
        )}
        {!loads && [0, 1].map((dir) => (
          <rect key={dir} x={LANE[dir] - LANE_W / 2} y={TOP} width={LANE_W} height={(n - 1) * ROW} fill="var(--crowd-empty)" />
        ))}
        {suspended.map((d) => {
          const a = rowOf(d.stop_id);
          const b = rowOf(d.to_stop_id!);
          const y0 = TOP + Math.min(a, b) * ROW;
          return (
            <rect key={d.id} x={LANE[0] - LANE_W / 2 - 4} y={y0} width={LANE[1] - LANE[0] + LANE_W + 8}
              height={Math.abs(b - a) * ROW} fill="none" stroke="var(--status-critical)" strokeWidth={2} strokeDasharray="4 3" rx={3} />
          );
        })}
        {line.stations.map((s, i) => (
          <g key={s.id}>
            <circle cx={LANE[0]} cy={TOP + i * ROW} r={4.5} fill="#fff" stroke="var(--line-kj)" strokeWidth={2.5} />
            <circle cx={LANE[1]} cy={TOP + i * ROW} r={4.5} fill="#fff" stroke="var(--line-kj)" strokeWidth={2.5} />
          </g>
        ))}
      </svg>
      <ol className="absolute inset-0" aria-label="Stations">
        {line.stations.map((s, i) => {
          const mark = marked.get(s.id);
          return (
            <li key={s.id} className="absolute inset-x-0" style={{ top: TOP + i * ROW - ROW / 2, height: ROW }}>
              <button type="button" onClick={() => onSelect(s.id)} aria-pressed={selected === s.id}
                className={`flex h-full w-full items-center gap-2.5 pl-[72px] pr-3 text-left transition-colors ${selected === s.id ? "bg-accent-soft" : "hover:bg-surface-2"}`}>
                <StationCode id={s.id} size="sm" />
                <span className={`truncate text-sm ${selected === s.id ? "font-bold text-accent" : "font-medium text-ink"}`}>{s.name}</span>
                <Interchanges id={s.id} />
                {mark && (
                  <span className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: mark === "surge" ? "var(--highlight-soft)" : "#fef2f2", color: mark === "surge" ? "#9a3412" : "#991b1b" }}>
                    {mark === "surge" ? "Event crowd" : mark === "hold" ? "Train held" : "Delays"}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      <div ref={layer} className="pointer-events-none absolute inset-0 [&>button]:pointer-events-auto" />
    </div>
  );
}

export function StripLegend() {
  return (
    <p className="text-xs text-ink-3">
      Left track to <span className="font-semibold text-ink-2">Gombak ↑</span> · right track to <span className="font-semibold text-ink-2">Putra Heights ↓</span>
    </p>
  );
}
