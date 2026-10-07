"use client";

/**
 * The live page: the map is the app (docs/AERA_UX_V2.md). A full-screen 3D map with search,
 * clock and service status floating at the top left, map buttons on the right edge, and one
 * card about whatever is in focus: my station, a station, or a train. On desktop the card sits
 * in the left column; on phones it is a bottom sheet. The selection is kept in the URL so a
 * view can be shared (MAP-06).
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState, Skeleton } from "@/components/States";
import { Logo } from "@/components/TopBar";
import { attachEngine } from "@/lib/crowd/feed";
import { useCrowd, useMediaQuery, useSimNow } from "@/lib/hooks";
import { useUi } from "@/lib/ui";
import { GeoMap, type MapInset } from "./GeoMap";
import { HomeStationCard } from "./HomeStationCard";
import { BrandPill, ClockCard, ClockChips, CrowdKey, FLOAT, MapButtons, NavPill, StationSearch } from "./MapChrome";
import { Sheet } from "./Sheet";
import { StationCard, StationPeek } from "./StationCard";
import { TrainDetail } from "./TrainDetail";

const DESKTOP_INSET: MapInset = { top: 0, left: 432, right: 72, bottom: 0 };

export function LiveView() {
  const { line, engine, error } = useCrowd("KJ");
  const wide = useMediaQuery("(min-width: 1024px)");
  const { selectedStation, selectedTrain, selectStation, selectTrain } = useUi();
  const [sheetH, setSheetH] = useState(0);
  const [bearing, setBearing] = useState(0);
  const [keyOpen, setKeyOpen] = useState<boolean | null>(null);
  const now = useSimNow(5000);
  const restored = useRef(false);

  useEffect(() => {
    if (engine) attachEngine(engine);
  }, [engine]);

  // Open what the link points at, once the line is known.
  useEffect(() => {
    if (!line || restored.current) return;
    restored.current = true;
    const p = new URLSearchParams(window.location.search);
    const st = p.get("station");
    const tr = p.get("train");
    if (st && line.stations.some((s) => s.id === st)) selectStation(st);
    else if (tr) selectTrain(tr);
  }, [line, selectStation, selectTrain]);

  useEffect(() => {
    if (!restored.current) return;
    const q = selectedStation ? `?station=${selectedStation}` : selectedTrain ? `?train=${encodeURIComponent(selectedTrain)}` : "";
    if (window.location.search !== q) window.history.replaceState(null, "", `${window.location.pathname}${q}`);
  }, [selectedStation, selectedTrain]);

  // Esc closes the card (CARD-05).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === "Escape" && !(el && (el.tagName === "INPUT" || el.tagName === "SELECT"))) selectStation(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectStation]);

  const onBearing = useCallback((b: number) => setBearing(Math.round(b)), []);
  const onSheet = useCallback((h: number) => setSheetH(h), []);
  const showKey = keyOpen ?? wide;

  if (error) {
    return <div className="p-6"><EmptyState title="Live data is unavailable" body={`The twin service did not answer (${error}). Check that it is running, then reload.`} /></div>;
  }

  const viewport = "fixed inset-x-0 top-0 bottom-[calc(70px+env(safe-area-inset-bottom))] overflow-hidden bg-[var(--map-bg)] lg:bottom-0";
  if (!line || !engine) {
    return (
      <div className={viewport}>
        <div className="absolute left-4 top-4 flex w-[min(400px,calc(100%-32px))] flex-col gap-3">
          <Skeleton className="h-12 rounded-full" /><Skeleton className="h-28" />
        </div>
      </div>
    );
  }

  const close = () => selectStation(null);
  const card = selectedTrain ? (
    <TrainDetail engine={engine} line={line} tripId={selectedTrain} onClose={() => selectTrain(null)} />
  ) : selectedStation ? (
    <StationCard engine={engine} line={line} stationId={selectedStation} onClose={close} />
  ) : (
    <HomeStationCard engine={engine} line={line} onOpen={selectStation} />
  );
  const cardKey = selectedTrain ? `t:${selectedTrain}` : selectedStation ? `s:${selectedStation}` : "home";
  const inset: MapInset = wide ? DESKTOP_INSET : { top: 112, left: 0, right: 56, bottom: sheetH };

  return (
    <div className={viewport}>
      <GeoMap line={line} engine={engine} selected={selectedStation} onSelect={selectStation} selectedTrain={selectedTrain} onSelectTrain={selectTrain}
        inset={inset} onBearing={onBearing}
        stationPeek={(id) => <StationPeek engine={engine} line={line} stationId={id} t={now / 1000} />} />

      {wide ? (
        <>
          <div className="pointer-events-none absolute bottom-4 left-4 top-4 z-10 flex w-100 flex-col gap-3">
            <div className="pointer-events-auto flex gap-2">
              <BrandPill />
              <StationSearch line={line} onPick={selectStation} className="min-w-0 flex-1" />
            </div>
            <div className="pointer-events-auto"><ClockCard line={line} /></div>
            <section key={cardKey} aria-label="Details" className={`enter pointer-events-auto min-h-0 overflow-y-auto overscroll-contain rounded-[20px] p-4 ${FLOAT}`}>
              {card}
            </section>
          </div>
          <div className="absolute right-4 top-4 z-10"><NavPill /></div>
          <div className="absolute right-4 top-1/2 z-10 -translate-y-1/2">
            <MapButtons bearing={bearing} keyOpen={showKey} onKey={() => setKeyOpen(!showKey)} />
          </div>
          {showKey && <div className="absolute bottom-9 right-4 z-10 w-74"><CrowdKey onClose={() => setKeyOpen(false)} /></div>}
        </>
      ) : (
        <>
          <div className="absolute inset-x-3 top-3 z-20 flex flex-col gap-2">
            <StationSearch line={line} onPick={selectStation}
              leading={<Link href="/about" aria-label="About AERA" className="shrink-0"><Logo markOnly /></Link>} />
            <div className="pr-14"><ClockChips line={line} /></div>
          </div>
          <div className="absolute right-3 top-29 z-10">
            <MapButtons compact bearing={bearing} keyOpen={showKey} onKey={() => setKeyOpen(!showKey)} />
          </div>
          {showKey && <div className="absolute left-3 right-17 top-29 z-10"><CrowdKey onClose={() => setKeyOpen(false)} /></div>}
          <Sheet peek={selectedTrain ? 252 : selectedStation ? 318 : 236} label="Details" onHeight={onSheet} resetKey={cardKey}>
            <div key={cardKey} className="enter">{card}</div>
          </Sheet>
        </>
      )}
    </div>
  );
}
