"use client";

/**
 * The live page's first card (LIVE-01, LIVE-02): the answer before the map. The rider's
 * station (the nearest one when the phone knows where it is, otherwise My station), the next
 * train each way with how long to wait, how full it is and car by car where there is room.
 * "Show on map" flies the 3D twin to that train and follows it. The card is white and calm:
 * colour is kept for crowding, on the train itself and its label.
 */

import { CaretRight, Crosshair, MapPin, NavigationArrow, Star } from "@phosphor-icons/react/dist/ssr";
import { useEffect, useMemo, useState } from "react";
import { CrowdIcon, CrowdTag, TrainCars } from "@/components/Crowd";
import { StationCode } from "@/components/StationCode";
import { latest } from "@/lib/crowd/feed";
import { crowdInkVar, crowdOf, pctText } from "@/lib/crowd/levels";
import type { CrowdEngine, Departure } from "@/lib/crowd/model";
import { klTime } from "@/lib/format";
import { useHome } from "@/lib/home";
import { useSimNow } from "@/lib/hooks";
import { NEAR_KM, distanceText, nearestStation, useNearby } from "@/lib/nearby";
import { NO_DISRUPTIONS, useTwin } from "@/lib/store";
import type { LineData } from "@/lib/types";
import { useUi } from "@/lib/ui";
import { StationImage } from "./StationCard";

const DIR_KEY = "aera.glanceDir";

function savedDir(station: string): number | null {
  try {
    const v = JSON.parse(localStorage.getItem(DIR_KEY) ?? "{}")[station];
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
}

function saveDir(station: string, dir: number) {
  try {
    const all = JSON.parse(localStorage.getItem(DIR_KEY) ?? "{}");
    localStorage.setItem(DIR_KEY, JSON.stringify({ ...all, [station]: dir }));
  } catch {}
}

const minsTo = (at: number, t: number) => Math.max(0, Math.round((at - t) / 60));

/** "3 min", "Now", or the clock time when it is a long way off. */
function waitText(at: number, t: number): string {
  const m = minsTo(at, t);
  if (m === 0) return "Now";
  if (m > 90) return klTime(at * 1000);
  return `${m} min`;
}

export function GlanceCard({ engine, line, onOpenStation, onOpenTrain }: {
  engine: CrowdEngine; line: LineData; onOpenStation: (id: string) => void; onOpenTrain: (trip: string) => void;
}) {
  const home = useHome((s) => s.id);
  const loadHome = useHome((s) => s.load);
  useEffect(() => loadHome(line.stations.map((s) => s.id)), [line, loadHome]);
  const { pos, state: locState, locate } = useNearby();
  const near = useMemo(() => (pos ? nearestStation(line.stations, pos) : null), [pos, line]);
  const nearOk = !!near && near.km <= NEAR_KM;
  const [useHomeStation, setUseHomeStation] = useState(false);
  const stationId = nearOk && !useHomeStation ? near!.station.id : home;
  const st = line.stations.find((s) => s.id === stationId)!;
  const isNear = nearOk && !useHomeStation;

  const now = useSimNow(5000);
  const t = now / 1000;
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  const mult = useTwin((s) => s.sim?.scenario.demand_mult ?? 1);

  const dirs = useMemo(() => line.directions.filter((d) => engine.line.stopIndex[d.direction_id][stationId] !== d.stops.length - 1), [line, engine, stationId]);
  const deps = useMemo(() => Object.fromEntries(dirs.map((d) => {
    const soon = engine.departures(stationId, d.direction_id, t, disruptions, mult, 3);
    // At night the next train can be more than the engine's three-hour look-ahead away.
    const later = soon.length ? [] : engine.departures(stationId, d.direction_id, t + 3 * 3600, disruptions, mult, 1);
    return [d.direction_id, { soon, first: later[0] ?? null }];
  })) as Record<number, { soon: Departure[]; first: Departure | null }>, [engine, dirs, stationId, t, disruptions, mult]);

  const [dir, setDir] = useState<number | null>(null);
  // Default: the way the rider last looked from this station, else the train that comes first.
  const soonestDir = dirs.map((d) => d.direction_id).sort((a, b) => (deps[a]?.soon[0]?.arrival ?? Infinity) - (deps[b]?.soon[0]?.arrival ?? Infinity))[0];
  const shownDir = dir !== null && dirs.some((d) => d.direction_id === dir) ? dir : savedDir(stationId) ?? soonestDir ?? dirs[0]?.direction_id ?? 0;
  useEffect(() => setDir(null), [stationId]);

  const d = line.directions.find((x) => x.direction_id === shownDir)!;
  const next = deps[shownDir]?.soon[0] ?? null;
  const trip = next?.run.trip.id ?? null;

  // Tell the map which train to show: the next one this way, once it is out on the line.
  const setGlance = useUi((s) => s.setGlance);
  const running = !!trip && latest.trains.some((x) => x.run.trip.id === trip);
  useEffect(() => setGlance(stationId, running ? trip : null), [stationId, trip, running, setGlance]);
  useEffect(() => () => setGlance(null, null), [setGlance]);

  const cam = useUi((s) => s.cam);
  const glanceTrip = useUi((s) => s.glanceTrip);
  const onMap = useUi((s) => s.glanceOnMap);
  const focusGlance = useUi((s) => s.focusGlance);
  const following = onMap && cam === "follow" && !!glanceTrip && glanceTrip === trip;

  const pick = (id: number) => {
    setDir(id);
    saveDir(stationId, id);
    // When the map is already on the rider's train, it moves to the train the other way.
    if (useUi.getState().glanceOnMap) setTimeout(() => useUi.getState().focusGlance(), 60);
  };

  const cars = next ? engine.carLoads(next.loadPct, shownDir) : null;
  const people = next ? Math.round((Math.min(next.loadPct, 100) / 100) * engine.capacity) : 0;
  const wait = next ? minsTo(next.arrival, t) : 0;
  const first = wait > 90;

  // One quiet line under the station: switch source, or ask for the location.
  const helper = nearOk && near!.station.id !== home ? (
    <button type="button" onClick={() => setUseHomeStation(!useHomeStation)} className="font-semibold text-accent hover:underline">
      {useHomeStation ? `Use the station near you (${near!.station.name})` : `Switch to My station (${line.stations.find((s) => s.id === home)?.name})`}
    </button>
  ) : !pos && locState !== "unavailable" ? (
    locState === "denied" ? <span>Location is off, so this is My station.</span> : (
      <button type="button" onClick={() => locate(true)} disabled={locState === "locating"} className="inline-flex items-center gap-1 font-semibold text-accent hover:underline disabled:opacity-60">
        <MapPin size={13} weight="fill" aria-hidden />{locState === "locating" ? "Finding you…" : "Use my location"}
      </button>
    )
  ) : pos && !nearOk && near ? <span>You are {distanceText(near.km)} from the line, so this is My station.</span> : null;

  return (
    <section aria-label="Your next train">
      {/* Where */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => onOpenStation(stationId)} aria-label={`Open ${st.name}`} className="pressable shrink-0 overflow-hidden rounded-[14px]">
          <StationImage id={stationId} className="h-11 w-11" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.06em] text-ink-3">
            {isNear ? <><NavigationArrow size={11} weight="fill" className="text-accent" aria-hidden />Near you · {distanceText(near!.km)}</> : <><Star size={11} weight="fill" className="text-highlight" aria-hidden />My station</>}
          </p>
          <h2 className="flex min-w-0 items-center gap-2 text-[20px] font-extrabold leading-tight tracking-tight text-ink">
            <span className="truncate">{st.name}</span><StationCode id={stationId} size="sm" />
          </h2>
        </div>
        <button type="button" onClick={() => onOpenStation(stationId)} aria-label={`All trains at ${st.name}`}
          className="pressable flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-2 hover:bg-surface-3">
          <CaretRight size={16} weight="bold" aria-hidden />
        </button>
      </div>
      {helper && <p className="mt-1.5 pl-14 text-[12px] text-ink-3">{helper}</p>}

      {/* Which way: tabs with the wait in each */}
      {dirs.length > 1 && (
        <div role="tablist" aria-label="Direction" className="mt-4 grid grid-cols-2 border-b border-rule">
          {dirs.map((x) => {
            const on = x.direction_id === shownDir;
            const n = deps[x.direction_id]?.soon[0];
            return (
              <button key={x.direction_id} type="button" role="tab" aria-selected={on} onClick={() => pick(x.direction_id)}
                className={`relative min-w-0 px-1 pb-2.5 text-left transition-colors ${on ? "text-ink" : "text-ink-3 hover:text-ink-2"}`}>
                <span className="block truncate text-[12.5px] font-semibold">To {x.headsign}</span>
                <span className="num block text-[15px] font-extrabold">{n ? waitText(n.arrival, t) : "No trains"}</span>
                <span aria-hidden className={`absolute inset-x-1 -bottom-px h-[3px] rounded-full ${on ? "bg-accent" : "bg-transparent"}`} />
              </button>
            );
          })}
        </div>
      )}

      {next && cars ? (
        <>
          {/* The next train: wait and how full */}
          <div className="mt-4 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-medium text-ink-3">
                {first ? "First train" : "Next train"}{dirs.length > 1 ? "" : ` to ${d.headsign}`}
                {!first && <> · <span className="num">{klTime(next.arrival * 1000)}</span></>}
                {next.delayS > 120 && <span className="font-bold text-critical"> · {Math.round(next.delayS / 60)} min late</span>}
              </p>
              <p className="num mt-0.5 text-[40px] font-extrabold leading-none tracking-[-0.03em] text-ink">
                {first ? klTime(next.arrival * 1000) : wait === 0 ? "Now" : <>{wait}<span className="ml-1 text-[16px] font-bold tracking-normal text-ink-3">min</span></>}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5 pb-0.5">
              <CrowdTag loadPct={next.loadPct} />
              <span className="num text-[12px] text-ink-3">{next.loadPct >= 100 ? "Over capacity" : `${pctText(next.loadPct)} · ~${people} on board`}</span>
            </div>
          </div>

          {/* Car by car */}
          <div className="mt-4"><TrainCars cars={cars} /></div>
          <p className="mt-2.5 text-[13px] leading-snug text-ink-2">{roomText(cars)}</p>

          {/* The trains after it */}
          {deps[shownDir].soon.length > 1 && (
            <ul aria-label="Trains after it" className="mt-4 divide-y divide-rule border-y border-rule">
              {deps[shownDir].soon.slice(1).map((x) => {
                const lv = crowdOf(x.loadPct);
                return (
                  <li key={x.run.trip.id} className="flex items-center gap-3 py-2.5 text-[13.5px]">
                    <span className="num w-12 font-bold text-ink">{klTime(x.arrival * 1000)}</span>
                    <span className="num flex-1 text-ink-3">{waitText(x.arrival, t) === "Now" ? "now" : `in ${waitText(x.arrival, t)}`}</span>
                    <span className="flex items-center gap-1.5 font-semibold" style={{ color: crowdInkVar(lv.level) }}>
                      <CrowdIcon level={lv.level} size={15} />{lv.name}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {running && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={focusGlance} aria-pressed={following}
                className={`pressable flex h-11 items-center justify-center gap-1.5 rounded-full text-[13.5px] font-bold ${following ? "bg-accent-soft text-accent" : "border border-rule bg-white text-ink hover:bg-surface-2"}`}>
                <Crosshair size={16} weight="bold" aria-hidden />{following ? "On the map" : "Show on map"}
              </button>
              <button type="button" onClick={() => onOpenTrain(next.run.trip.id)}
                className="pressable flex h-11 items-center justify-center gap-1 rounded-full bg-ink text-[13.5px] font-bold text-white hover:bg-ink/90">
                Train details<CaretRight size={14} weight="bold" aria-hidden />
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="mt-4 rounded-2xl bg-surface-2 p-4">
          <p className="text-[15px] font-bold text-ink">No trains running now</p>
          <p className="mt-0.5 text-[13px] text-ink-2">
            {deps[shownDir]?.first
              ? <>The first train to {d.headsign} reaches {st.name} at <span className="num font-bold text-ink">{klTime(deps[shownDir].first!.arrival * 1000)}</span>.</>
              : <>Trains run from about 06:00 to midnight.</>}
          </p>
        </div>
      )}

    </section>
  );
}

/** Where to stand, in words. */
function roomText(cars: number[]): string {
  const lv = cars.map((c) => crowdOf(c));
  if (lv.every((x) => x.level === lv[0].level)) return `Every car is about the same: ${lv[0].name}.`;
  const i = cars.indexOf(Math.min(...cars));
  const where = i === 0 ? " at the front" : i === cars.length - 1 ? " at the back" : "";
  return `Most room in car ${i + 1}${where} (${lv[i].name}).`;
}
