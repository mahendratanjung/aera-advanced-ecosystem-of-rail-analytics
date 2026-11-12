"use client";

/**
 * The live page: the map is the app (docs/AERA_UX_V2.md). A full-screen 3D map with search,
 * clock and service status floating at the top left, map buttons on the right edge, and one
 * card about whatever is in focus: your next train, a station, or a train. On desktop the card
 * sits in the left column; on phones it is a bottom sheet. The selection is kept in the URL so a
 * view can be shared (MAP-06).
 *
 * Revision 6 (LIVE-01..03): the map opens close on KLCC and the Petronas Towers; with nothing
 * picked, the card answers first (the next train at the station near you, how full it is, car by
 * car), and "Show on map" flies the twin to that train and follows it.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState, Skeleton } from "@/components/States";
import { AssistantChat } from "@/features/assistant/AssistantChat";
import { Logo } from "@/components/TopBar";
import { attachEngine } from "@/lib/crowd/feed";
import { useCrowd, useMediaQuery, useSimNetwork, useSimNow } from "@/lib/hooks";
import { isNetTrain } from "@/lib/network/trains";
import { NetTrainCard } from "@/features/network/NetTrainCard";
import { usePrefs } from "@/lib/prefs";
import { restoreMapView, useUi } from "@/lib/ui";
import { GeoMap, type MapInset } from "./GeoMap";
import { GlanceCard } from "./GlanceCard";
import { LineList } from "./LineList";
import { UserCircle } from "@phosphor-icons/react/dist/ssr";
import { neverAsked, useNearby } from "@/lib/nearby";
import { AheadBar, BrandPill, ClockCard, ClockChips, CrowdKey, FLOAT, LayersPanel, MapButtons, NavPill, PhoneMapButtons, StationSearch, TourChip } from "./MapChrome";
import { Sheet } from "./Sheet";
import { ShortcutsPanel, useMapShortcuts } from "./Shortcuts";
import { StationCard, StationPeek } from "./StationCard";
import { CameraModes, TrainDetail } from "./TrainDetail";

const DESKTOP_INSET: MapInset = { top: 0, left: 432, right: 72, bottom: 0 };

export function LiveView() {
  const { line, engine, error } = useCrowd("KJ");
  const { net } = useSimNetwork();
  const wide = useMediaQuery("(min-width: 1024px)");
  const { selectedStation, selectedTrain, selectStation, selectTrain, asking, askSeed, setAsking, listing, setListing } = useUi();
  const [sheetH, setSheetH] = useState(0);
  const [bearing, setBearing] = useState(0);
  const [keyOpen, setKeyOpen] = useState<boolean | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const glanceTrip = useUi((s) => s.glanceTrip);
  const glanceStation = useUi((s) => s.glanceStation);
  const touring = useUi((s) => s.touring);
  const now = useSimNow(5000);
  const restored = useRef(false);

  useEffect(() => {
    if (engine) attachEngine(engine);
  }, [engine]);

  // The map opens with the switches the rider left it with.
  useEffect(() => restoreMapView(), []);

  // LIVE-01: find the station near the rider. The browser asks once, on the first visit;
  // afterwards the position is only read when it is already allowed.
  useEffect(() => {
    void useNearby.getState().locate(neverAsked());
  }, []);

  // The welcome page was removed (user request, 13 Nov 2026): Live is the first screen.
  const router = useRouter();
  useEffect(() => {
    usePrefs.getState().load();
  }, []);

  // Open what the link points at, once the line is known.
  useEffect(() => {
    if (!line || restored.current) return;
    restored.current = true;
    // A refresh starts fresh on KLCC (user request, 13 Nov 2026): the station or train picked
    // before is dropped from the address. Opening a shared link still goes to what it names.
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav?.type === "reload") {
      if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
      return;
    }
    const p = new URLSearchParams(window.location.search);
    const st = p.get("station");
    const tr = p.get("train");
    if (st && line.stations.some((s) => s.id === st)) selectStation(st);
    else if (tr) selectTrain(tr);
    else if (p.get("ask") && window.matchMedia("(min-width: 1024px)").matches) setAsking(true);
  }, [line, selectStation, selectTrain, setAsking]);

  const idle = !selectedStation && !selectedTrain && !listing && !asking && !touring;
  const glanceOnMap = useUi((s) => s.glanceOnMap);

  useEffect(() => {
    if (!restored.current) return;
    const q = selectedStation ? `?station=${selectedStation}` : selectedTrain ? `?train=${encodeURIComponent(selectedTrain)}` : asking ? "?ask=1" : "";
    if (window.location.search !== q) window.history.replaceState(null, "", `${window.location.pathname}${q}`);
  }, [selectedStation, selectedTrain, asking]);

  // Esc closes the card (CARD-05).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === "Escape" && !(el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA"))) {
        selectStation(null);
        setAsking(false);
        setListing(false);
        useUi.getState().setKeysOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectStation, setAsking, setListing]);

  const onBearing = useCallback((b: number) => setBearing(Math.round(b)), []);
  const onSheet = useCallback((h: number) => setSheetH(h), []);
  const showKey = keyOpen ?? wide;
  const toggleKey = useCallback(() => setKeyOpen((k) => !(k ?? window.matchMedia("(min-width: 1024px)").matches)), []);
  useMapShortcuts(toggleKey);

  if (error) {
    return (
      <div className="mx-auto max-w-md p-6 pt-16">
        <EmptyState title="Live service data is temporarily unavailable"
          body="AERA could not load the line just now. Check your connection and try again."
          action={<button type="button" onClick={() => window.location.reload()} className="pressable mt-2 rounded-full bg-accent px-4 py-2 text-[14px] font-bold text-white">Try again</button>} />
      </div>
    );
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
  const card = asking && wide ? (
    <AssistantChat key={askSeed ?? "ask"} variant="card" initial={askSeed} onClose={() => setAsking(false)} />
  ) : listing ? (
    <LineList engine={engine} line={line} onClose={() => setListing(false)} />
  ) : selectedTrain && isNetTrain(selectedTrain) ? (
    <NetTrainCard id={selectedTrain} onClose={() => selectTrain(null)}>
      <div className="mt-3"><CameraModes /></div>
    </NetTrainCard>
  ) : selectedTrain ? (
    <TrainDetail engine={engine} line={line} tripId={selectedTrain} onClose={() => selectTrain(null)} />
  ) : selectedStation ? (
    <StationCard engine={engine} line={line} stationId={selectedStation} onClose={close} />
  ) : (
    <GlanceCard engine={engine} line={line} onOpenStation={selectStation} onOpenTrain={selectTrain} />
  );
  const cardKey = asking && wide ? "ask" : listing ? "list" : selectedTrain ? `t:${selectedTrain}` : selectedStation ? `s:${selectedStation}` : "home";
  const inset: MapInset = wide ? DESKTOP_INSET : { top: 104, left: 0, right: 0, bottom: sheetH };
  // The map opens on KLCC; once the rider taps "Show on map" it shows the card's train (or,
  // before the first train, its station).
  const mapTrain = selectedTrain ?? (idle && glanceOnMap ? glanceTrip : null);
  const mapStation = selectedStation ?? (idle && glanceOnMap && !glanceTrip ? glanceStation : null);

  return (
    <div className={viewport}>
      <GeoMap line={line} engine={engine} net={net} selected={mapStation} onSelect={selectStation} selectedTrain={mapTrain} onSelectTrain={selectTrain}
        onOtherStation={(id) => router.push(`/network?station=${encodeURIComponent(id)}`)}
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
            <MapButtons bearing={bearing} keyOpen={showKey} onKey={toggleKey} />
          </div>
          {/* Left of the button column, so neither covers the other on short screens. */}
          {showKey && <div className="absolute bottom-9 right-18 z-10 w-74"><CrowdKey onClose={() => setKeyOpen(false)} /></div>}
          <div className="absolute right-18 top-20 z-20"><ShortcutsPanel /></div>
          {/* Centred over the part of the map the card leaves clear. */}
          <div className="pointer-events-none absolute bottom-9 left-108 right-96 z-10 flex justify-center"><div className="pointer-events-auto flex max-w-full flex-col items-center gap-2"><AheadBar /><TourChip line={line} /></div></div>
        </>
      ) : (
        <>
          <div className="safe-top absolute inset-x-3 top-0 z-20 flex flex-col gap-2 pt-3">
            <StationSearch line={line} onPick={selectStation}
              leading={<span className="shrink-0"><Logo markOnly /></span>}
              trailing={<Link href="/me" aria-label="You: your station, saved rides and settings" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2"><UserCircle size={28} aria-hidden /></Link>} />
            <div className="pr-14"><ClockChips line={line} /></div>
            <TourChip line={line} />
            <AheadBar />
          </div>
          <div className="absolute right-3 top-[calc(max(0.75rem,env(safe-area-inset-top))+108px)] z-10">
            <PhoneMapButtons bearing={bearing} layersOpen={layersOpen} onLayers={() => setLayersOpen((v) => !v)} />
          </div>
          {layersOpen && <div className="absolute left-3 right-17 top-[calc(max(0.75rem,env(safe-area-inset-top))+108px)] z-30"><LayersPanel onClose={() => setLayersOpen(false)} keyOpen={showKey} onKey={toggleKey} /></div>}
          {showKey && !layersOpen && <div className="absolute left-3 right-17 top-[calc(max(0.75rem,env(safe-area-inset-top))+108px)] z-10"><CrowdKey onClose={() => setKeyOpen(false)} /></div>}
          <Sheet peek={listing ? 420 : selectedTrain ? 252 : selectedStation ? 318 : 470} label="Details" onHeight={onSheet} resetKey={cardKey}>
            <div key={cardKey} className="enter">{card}</div>
          </Sheet>
        </>
      )}
    </div>
  );
}
