"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/States";
import { useLine, useReducedMotion, useStationDefinition } from "@/lib/hooks";
import { useTwin } from "@/lib/store";
import { token } from "@/lib/theme";
import { Plan2D } from "./Plan2D";
import type { Preset } from "./Scene3D";

// NFR-04: three.js loads only when a station twin is opened.
const Scene3D = dynamic(() => import("./Scene3D"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center"><p className="eyebrow pulse-slow">Building the station…</p></div>,
});

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function StationTwin({ stationId, selectedZone, onSelectZone, dive = false, compactToolbar = false }: {
  stationId: string; selectedZone: string | null; onSelectZone: (id: string | null) => void; dive?: boolean; compactToolbar?: boolean;
}) {
  const { def, error } = useStationDefinition(stationId);
  const { line, model } = useLine("KJ");
  const twin = useTwin((s) => s.twins[stationId]);
  const reduced = useReducedMotion();
  const [view, setView] = useState<"3d" | "plan">("3d");
  const [gl, setGl] = useState(true);
  const [preset, setPreset] = useState<Preset>("overview");
  const [nonce, setNonce] = useState(0);
  const [exploded, setExploded] = useState(false);
  const [particles, setParticles] = useState(true);

  useEffect(() => {
    const ok = webglAvailable();
    setGl(ok);
    if (!ok) setView("plan");
  }, []);

  const presets = useMemo(() => {
    if (!def) return [];
    const list: { id: Preset; label: string }[] = [{ id: "overview", label: "Overview" }];
    const concourse = def.zones.find((z) => z.type === "concourse");
    if (concourse) list.push({ id: concourse.id as Preset, label: concourse.name });
    for (const z of def.zones.filter((zz) => zz.type === "platform")) list.push({ id: z.id as Preset, label: z.name });
    list.push({ id: "plan", label: "Top down" });
    return list;
  }, [def]);

  if (error) return <div className="p-6"><EmptyState title="This station has no twin yet" body={error} /></div>;
  if (!def || !twin) {
    return <div className="flex h-full items-center justify-center"><p className="eyebrow pulse-slow">Loading station twin…</p></div>;
  }
  const lineColor = line?.color ?? token("--brand-cyan");
  const stationDistance = line?.stations.find((s) => s.id === def.stop_id)?.distance_m ?? 0;
  const seg = (active: boolean) => `rounded px-2.5 py-1 text-xs font-semibold ${active ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`;

  return (
    <div className="relative h-full w-full">
      <div className="absolute inset-0">
        {view === "3d" ? (
          <Scene3D
            def={def} twin={twin} model={model} lineColor={lineColor} stationDistance={stationDistance}
            selectedZone={selectedZone} onSelectZone={onSelectZone} preset={preset} presetNonce={nonce}
            exploded={exploded} particles={particles} reducedMotion={reduced} dive={dive}
          />
        ) : (
          <div className="h-full overflow-auto p-4"><Plan2D def={def} twin={twin} selectedZone={selectedZone} onSelectZone={onSelectZone} /></div>
        )}
      </div>
      <div className={`absolute left-3 right-3 flex items-center gap-2 overflow-x-auto pb-1 md:right-auto md:flex-wrap md:overflow-visible ${compactToolbar ? "top-3" : "top-3 md:top-4"}`}>
        <div role="group" aria-label="View" className="panel flex shrink-0 gap-1 p-1">
          <button type="button" className={seg(view === "3d")} aria-pressed={view === "3d"} disabled={!gl} onClick={() => setView("3d")}>3D</button>
          <button type="button" className={seg(view === "plan")} aria-pressed={view === "plan"} onClick={() => setView("plan")}>Plan</button>
        </div>
        {view === "3d" && (
          <>
            <div role="group" aria-label="Camera presets" className="panel flex shrink-0 gap-1 p-1">
              {presets.map((p) => (
                <button key={p.id} type="button" className={seg(preset === p.id)} aria-pressed={preset === p.id}
                  onClick={() => { setPreset(p.id); setNonce((n) => n + 1); }}>
                  {p.label}
                </button>
              ))}
            </div>
            <div role="group" aria-label="Display" className="panel flex shrink-0 gap-1 p-1">
              <button type="button" className={seg(exploded)} aria-pressed={exploded} onClick={() => setExploded((v) => !v)}>Exploded</button>
              <button type="button" className={seg(particles)} aria-pressed={particles} onClick={() => setParticles((v) => !v)}>Crowd</button>
            </div>
          </>
        )}
      </div>
      {!gl && <p className="absolute bottom-3 left-3 text-xs text-muted">3D is not available on this device, so the plan view is shown.</p>}
    </div>
  );
}
