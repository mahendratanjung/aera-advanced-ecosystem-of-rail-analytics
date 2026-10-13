"use client";

/**
 * How full every line's trains are right now (NETC-03): the Kelana Jaya Line from the live
 * engine, the other lines from the typical-week network model. Shared by Busy times (riders)
 * and Control (operators).
 */

import { useMemo } from "react";
import { useCrowd, useNetCrowd, useSimNetwork } from "@/lib/hooks";
import { lineNow } from "@/lib/network/crowd";
import { LINES, type LineDef } from "@/lib/network/schematic";
import { trainsAt } from "@/lib/network/trains";
import { NO_DISRUPTIONS, useTwin } from "@/lib/store";

export interface LineRow {
  def: LineDef;
  running: number;
  /** Mean load of trains running now, % of capacity. */
  mean: number;
  /** Fullest train now and where it is. */
  max: number;
  from: string;
  to: string;
  /** "live" for Kelana Jaya (reacts to delays), "typical" for the rest. */
  kind: "live" | "typical";
}

export function useLinesNow(t: number): { rows: LineRow[]; ready: boolean } {
  const { line, engine } = useCrowd("KJ");
  const { net } = useSimNetwork();
  const model = useNetCrowd();
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  const mult = useTwin((s) => s.sim?.scenario.demand_mult ?? 1);
  // Recompute once a minute of sim time; the figures move slowly.
  const minute = Math.floor(t / 60);
  const rows = useMemo(() => {
    const at = minute * 60;
    const out: LineRow[] = [];
    if (engine && line) {
      const live = engine.live(at, disruptions, mult);
      if (live.length) {
        const top = [...live].sort((a, b) => b.loadPct - a.loadPct)[0];
        const stops = line.directions.find((d) => d.direction_id === top.run.trip.directionId)!.stops;
        const k = Math.min(top.state.stopIndex, stops.length - 2);
        const name = (id: string) => line.stations.find((s) => s.id === id)?.name ?? id;
        out.push({ def: LINES.find((l) => l.id === "KJ")!, running: live.length, kind: "live",
          mean: live.reduce((s, x) => s + x.loadPct, 0) / live.length, max: top.loadPct,
          from: name(stops[k].station_id), to: name(stops[k + 1].station_id) });
      }
    }
    if (net && model) {
      for (const sl of net.lines) {
        const def = LINES.find((l) => l.id === sl.id);
        if (!def || !model.lines[sl.id]) continue;
        const trains = trainsAt(sl, at);
        const now = lineNow(model, trains, at);
        if (now) out.push({ def, running: trains.length, kind: "typical", ...now });
      }
    }
    return out.sort((a, b) => b.max - a.max);
  }, [engine, line, net, model, disruptions, mult, minute]);
  return { rows, ready: !!engine && !!net && !!model };
}
