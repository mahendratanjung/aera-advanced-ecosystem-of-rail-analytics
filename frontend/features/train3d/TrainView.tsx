"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { CarDiagram } from "@/components/Crowd";
import { crowdOf, pctShort } from "@/lib/crowd/levels";
import { useReducedMotion } from "@/lib/hooks";

const Train3D = dynamic(() => import("./Train3D"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-card bg-surface-2" />,
});

function webgl(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** The 3D train with a car-by-car readout underneath. Falls back to the 2D diagram. */
export function TrainView({ cars, height = 200, compact = false }: { cars: number[]; height?: number; compact?: boolean }) {
  const reduced = useReducedMotion();
  const [gl, setGl] = useState<boolean | null>(null);
  useEffect(() => setGl(webgl()), []);
  const label = `Train, front first: ${cars.map((c, i) => `car ${i + 1} ${crowdOf(c).name}, ${pctShort(c)}`).join("; ")}`;
  return (
    <div>
      <div style={{ height }} className="relative overflow-hidden rounded-card bg-gradient-to-b from-surface-2 to-white">
        {gl === false ? (
          <div className="flex h-full items-center justify-center"><CarDiagram cars={cars} size="lg" showPct /></div>
        ) : gl ? (
          <Train3D cars={cars} reduced={reduced} height={height} label={label} />
        ) : null}
        <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-ink-2 shadow-sm">Front</span>
      </div>
      {!compact && (
        <ol className="mt-3 grid grid-cols-4 gap-2" aria-hidden>
          {cars.map((c, i) => {
            const lv = crowdOf(c).level;
            return (
              <li key={i} className="rounded-xl px-2 py-1.5 text-center" style={{ background: `var(--crowd-${lv}-soft)`, color: `var(--crowd-${lv}-ink)` }}>
                <span className="block text-[10px] font-semibold uppercase tracking-wide opacity-75">Car {i + 1}</span>
                <span className="num block text-sm font-bold">{pctShort(c)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
