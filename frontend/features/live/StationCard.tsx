"use client";

/**
 * The station card (CARD-02, CARD-03) and its hover preview (CARD-06). Both lead with the
 * station photo (PIC-01), credited to its author and licence.
 */

import { Check, ShareNetwork, Star, X } from "@phosphor-icons/react/dist/ssr";
import { useMemo, useState } from "react";
import { CrowdTag } from "@/components/Crowd";
import { Interchanges, StationCode } from "@/components/StationCode";
import type { CrowdEngine } from "@/lib/crowd/model";
import { useHome } from "@/lib/home";
import { stationPhoto } from "@/lib/photos";
import { NO_DISRUPTIONS, useTwin } from "@/lib/store";
import type { LineData } from "@/lib/types";
import { StationBoard } from "./StationBoard";

/** Photo with a line-coloured fallback when a station has none (PIC-02). */
export function StationImage({ id, className = "", alt = "" }: { id: string; className?: string; alt?: string }) {
  const p = stationPhoto(id);
  if (!p) return <div aria-hidden className={`bg-line ${className}`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={p.src} alt={alt} loading="lazy" decoding="async" className={`object-cover ${className}`} />;
}

export function PhotoCredit({ id, className = "" }: { id: string; className?: string }) {
  const p = stationPhoto(id);
  if (!p) return null;
  return (
    <a href={p.file} target="_blank" rel="noreferrer" className={`truncate text-[10px] font-medium hover:underline ${className}`}>
      Photo: {p.author} · {p.license}
    </a>
  );
}

function shareUrl(params: string): string {
  return `${window.location.origin}/?${params}`;
}

/** Copies a link to this view (MAP-06). Uses the share sheet on phones that have one. */
export function ShareButton({ params, title, tone = "light" }: { params: string; title: string; tone?: "light" | "dark" }) {
  const [done, setDone] = useState(false);
  const share = async () => {
    const url = shareUrl(params);
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) await navigator.share({ title, url });
      else await navigator.clipboard.writeText(url);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {}
  };
  const cls = tone === "dark" ? "bg-black/35 text-white hover:bg-black/50 backdrop-blur-sm" : "bg-surface-2 text-ink-2 hover:bg-surface-3";
  return (
    <button type="button" onClick={share} aria-label={done ? "Link copied" : `Share ${title}`} title={done ? "Link copied" : "Copy link"}
      className={`pressable flex h-9 w-9 items-center justify-center rounded-full ${cls}`}>
      {done ? <Check size={17} weight="bold" aria-hidden /> : <ShareNetwork size={17} weight="bold" aria-hidden />}
    </button>
  );
}

export function StationCard({ engine, line, stationId, onClose }: { engine: CrowdEngine; line: LineData; stationId: string; onClose: () => void }) {
  const st = line.stations.find((s) => s.id === stationId);
  const home = useHome((s) => s.id);
  const setHome = useHome((s) => s.set);
  if (!st) return null;
  const isHome = home === st.id;
  const dark = "pressable flex h-9 w-9 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm hover:bg-black/50";
  return (
    <div>
      <header className="relative mb-4 overflow-hidden rounded-2xl lg:-mx-4 lg:-mt-4 lg:rounded-none lg:rounded-t-[20px]">
        <StationImage id={st.id} alt={`${st.name} station`} className="h-28 w-full lg:h-46" />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-black/10" />
        <div className="absolute right-3 top-3 flex gap-2">
          <button type="button" onClick={() => setHome(st.id)} aria-pressed={isHome} className={dark}
            aria-label={isHome ? `${st.name} is your station` : `Set ${st.name} as my station`} title={isHome ? "Your station" : "Set as my station"}>
            <Star size={17} weight={isHome ? "fill" : "bold"} aria-hidden className={isHome ? "text-[#fcd34d]" : ""} />
          </button>
          <ShareButton params={`station=${st.id}`} title={st.name} tone="dark" />
          <button type="button" onClick={onClose} aria-label="Close station" className={dark}>
            <X size={17} weight="bold" aria-hidden />
          </button>
        </div>
        <div className="absolute inset-x-4 bottom-3 text-white">
          <div className="flex items-center gap-2">
            <StationCode id={st.id} size="md" />
            <Interchanges id={st.id} />
          </div>
          <h2 className="mt-1.5 truncate text-[26px] font-extrabold leading-tight tracking-tight drop-shadow-sm">{st.name}</h2>
          <PhotoCredit id={st.id} className="block text-white/75" />
        </div>
      </header>
      <StationBoard engine={engine} line={line} stationId={st.id} show3d={false} hideHeader />
    </div>
  );
}

/** Hover card for a station on the map: photo, name, next train each way. */
export function StationPeek({ engine, line, stationId, t }: { engine: CrowdEngine; line: LineData; stationId: string; t: number }) {
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  const mult = useTwin((s) => s.sim?.scenario.demand_mult ?? 1);
  const st = line.stations.find((s) => s.id === stationId);
  const next = useMemo(
    () => line.directions.map((d) => ({ d, dep: engine.departures(stationId, d.direction_id, t, disruptions, mult, 1)[0] })),
    [engine, line, stationId, t, disruptions, mult],
  );
  if (!st) return null;
  return (
    <div className="w-[260px]">
      <div className="relative">
        <StationImage id={st.id} className="h-[104px] w-full" />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
        <p className="absolute inset-x-3 bottom-2 flex items-center gap-2 text-[15px] font-extrabold text-white">
          <StationCode id={st.id} size="sm" />
          <span className="truncate">{st.name}</span>
        </p>
      </div>
      <ul className="space-y-1.5 px-3 py-2.5">
        {next.map(({ d, dep }) => {
          if (!dep) return null;
          const mins = Math.max(0, Math.round((dep.arrival - t) / 60));
          return (
            <li key={d.direction_id} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-ink-2">To {d.headsign}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="num font-bold text-ink">{mins === 0 ? "Now" : `${mins} min`}</span>
                <CrowdTag loadPct={dep.loadPct} size="sm" />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
