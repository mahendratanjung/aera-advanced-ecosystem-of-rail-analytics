"use client";

/**
 * Geographic view of the twin (NET-01 to NET-07), drawn in 3D in the manner of Mini Tokyo 3D:
 * a tilted camera over extruded buildings, the line as a viaduct in its official colour
 * (a translucent ribbon where it runs in tunnel), white station slabs, and modelled four-car
 * trains whose cars are coloured by predicted crowding (three.js, see trainLayer.ts).
 *
 * The scene is lit by the sun at the sim time and fades to night after sunset. Underground
 * mode dims the surface to bring the tunnel forward. A selected train can be followed,
 * chased from behind or orbited. Hovering a train or station shows a card.
 *
 * With a Mapbox token the basemap is Mapbox Standard, the same 3D city Mini Tokyo 3D uses:
 * modelled trees, landmarks and windowed facades, shadows, and dawn/day/dusk/night light
 * presets that follow the sim sun. Without a token, or if Mapbox refuses it, the map falls
 * back to the free Carto basemap with plain extruded buildings. Both engines take the same
 * custom layers, so the line and the trains are drawn identically.
 *
 * The map fills the screen (MAP-01). Its switches live in the UI store and its buttons float
 * over it (LiveView), which drives it through `mapApi`. `inset` keeps the selection clear of
 * the card or bottom sheet that covers part of the map (MAP-05).
 */

import type { ExpressionSpecification, GeoJSONSource, Map as MlMap, PaddingOptions, StyleSpecification } from "maplibre-gl";
import { Subway } from "@phosphor-icons/react/dist/ssr";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { CrowdTag } from "@/components/Crowd";
import { blocksAt } from "@/lib/advisor/advisor";
import { crowdOf } from "@/lib/crowd/levels";
import { type LiveTrain, latest, subscribe } from "@/lib/crowd/feed";
import type { CrowdEngine } from "@/lib/crowd/model";
import { lineBounds, pointAt } from "@/lib/sim/geo";
import { type Daylight, type Sun as SunPos, daylight, sunPosition } from "@/lib/sim/sun";
import { prefersReducedMotion, token } from "@/lib/theme";
import { useTwin } from "@/lib/store";
import type { LineData } from "@/lib/types";
import { useUi } from "@/lib/ui";
import { type BasemapTarget, type Palette, Palettes, paintBasemap, quietBasemap } from "./daylight";
import { TrackFrame, carPoses, crowdFeatures, dimsAt, stationFeatures, trackFeatures, travelSign } from "./geo3d";
import { type TrainDraw, TrainLayer } from "./trainLayer";
import { asTrack, lonLatAt, netCarPoses, netStationFeatures, netStationPoints, netTrackFeatures } from "./network3d";
import { layout, stationFor } from "@/lib/network/layout";
import { LINES } from "@/lib/network/schematic";
import { type NetTrain, type SimLine, type SimNetwork, findTrain, isNetTrain, trainsAt } from "@/lib/network/trains";
import { netTrainLoad } from "@/lib/network/crowd";
import { useNetCrowd } from "@/lib/hooks";

const STYLE_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const STYLE_STANDARD = "mapbox://styles/mapbox/standard";
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const CREDIT = "Timetable © Prasarana GTFS, ridership data.gov.my";

type Engine = "mapbox" | "maplibre";

/** Mapbox Standard, quietened: our own station labels replace its transit and POI labels. */
const STANDARD_CONFIG = {
  lightPreset: "day", show3dObjects: true, show3dTrees: true, show3dLandmarks: true, show3dFacades: true,
  showPointOfInterestLabels: false, showTransitLabels: false, showRoadLabels: false, showPedestrianRoads: false,
};

type LightPreset = "dawn" | "day" | "dusk" | "night";

function lightPreset(dl: Daylight): LightPreset {
  if (dl.night > 0.75) return "night";
  if (dl.night > 0.2 || dl.dusk > 0.45) return dl.phase === "Dawn" ? "dawn" : "dusk";
  return "day";
}

/** Mapbox calls the Map API shares with MapLibre; only the basemap settings differ. */
type MapboxExtras = { setConfigProperty(importId: string, key: string, value: unknown): void; setTerrain(t: null): void };

/** Null when `alive()` turns false while the library loads: every Mapbox map counts as a billed load. */
async function createMap(engine: Engine, container: HTMLElement, line: LineData, alive: () => boolean): Promise<MlMap | null> {
  const view = { container, bounds: lineBounds(line), fitBoundsOptions: { padding: padding() }, maxPitch: 78 };
  if (engine === "mapbox") {
    const mb = (await import("mapbox-gl")).default;
    if (!alive()) return null;
    const map = new mb.Map({
      ...view, accessToken: MAPBOX_TOKEN, style: STYLE_STANDARD, config: { basemap: STANDARD_CONFIG },
      // Custom layers draw in Web Mercator, so no globe.
      projection: "mercator", antialias: true, customAttribution: CREDIT,
    });
    return map as unknown as MlMap;
  }
  const ml = await import("maplibre-gl");
  if (!alive()) return null;
  ml.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
  return new ml.Map({
    ...view, style: STYLE_LIGHT,
    attributionControl: { compact: true, customAttribution: CREDIT },
    canvasContextAttributes: { antialias: true },
  });
}

function fallbackStyle(): StyleSpecification {
  return { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": token("--map-bg") } }] };
}

/** An upright font the basemap already serves (water labels use italics). */
function labelFont(map: MlMap, engine: Engine): string[] | null {
  if (engine === "mapbox") return ["DIN Pro Medium", "Arial Unicode MS Regular"];
  let any: string[] | null = null;
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.type !== "symbol") continue;
    const f = map.getLayoutProperty(layer.id, "text-font");
    if (!Array.isArray(f) || typeof f[0] !== "string") continue;
    any ??= f as string[];
    if (!(f as string[]).some((x) => /italic/i.test(x))) return f as string[];
  }
  return any;
}

function padding() {
  return window.innerWidth >= 1024 ? 64 : { top: 120, bottom: 40, left: 24, right: 64 };
}

export interface MapInset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Commands for the floating map buttons and the status line. Null until the map is ready. */
export interface MapApi {
  zoomBy: (delta: number) => void;
  resetNorth: () => void;
  wholeLine: () => void;
  /** Frame a stretch of the line between two stations. */
  showStretch: (fromId: string, toId: string) => void;
}

export const mapApi: { current: MapApi | null } = { current: null };

/** POL-07: the stations the tour stops at, end to end: termini, interchanges and the city centre. */
const TOUR = ["KJ1", "KJ5", "KJ9", "KJ10", "KJ13", "KJ14", "KJ15", "KJ16", "KJ19", "KJ24", "KJ28", "KJ31", "KJ37"];

const VIEW_3D = { pitch: 58, bearing: -20 };
const VIEW_2D = { pitch: 0, bearing: 0 };
const NOON: SunPos = { altitude: 62, azimuth: 140 };

/** The city-centre stretch the 3D view opens on (Damai to Universiti). */
function coreBounds(line: LineData): [[number, number], [number, number]] {
  const core = line.stations.filter((s) => s.distance_m >= 9500 && s.distance_m <= 20500);
  const lons = core.map((s) => s.lon);
  const lats = core.map((s) => s.lat);
  return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
}

/**
 * Extruded buildings from the basemap's own tiles, when it has them. Added above the line
 * and drawn translucent, so trains stay visible behind towers.
 */
function addBuildings(map: MlMap) {
  const src = map.getStyle().sources?.carto ? "carto" : null;
  if (!src) return;
  map.addLayer({
    id: "aera-buildings", type: "fill-extrusion", source: src, "source-layer": "building", minzoom: 13,
    filter: ["!=", ["get", "hide_3d"], true],
    paint: {
      "fill-extrusion-color": token("--map-building"),
      "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 13, 0, 14, ["coalesce", ["get", "render_height"], 6]],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": 0.55,
    },
  });
}

/**
 * `glow` (Mapbox only) is how much of the colour shows regardless of Standard's light preset,
 * so the line stripe and platforms still read at night.
 */
function extrusion(id: string, source: string, filter: unknown[], color: unknown, opacity: number | ExpressionSpecification, glow?: unknown) {
  return {
    id, type: "fill-extrusion" as const, source, filter: filter as never,
    paint: {
      "fill-extrusion-color": color as never,
      "fill-extrusion-base": ["get", "base"] as never,
      "fill-extrusion-height": ["get", "top"] as never,
      "fill-extrusion-opacity": opacity,
      "fill-extrusion-vertical-gradient": true,
      ...(glow == null ? {} : { "fill-extrusion-emissive-strength": glow }),
    },
  };
}

const STATION_LAYERS = ["aera-platforms", "aera-platforms-ug"];
/** Station labels gain the next train's crowding word from this zoom. */
const LABEL_CROWD_ZOOM = 12.3;
const CROWD_REFRESH_MS = 3000;
/** A train this many seconds behind its timetable carries the late beacon (TRAIN-04). */
const LATE_S = 120;

type Hover =
  | { kind: "train"; trip: string; headsign: string; status: string; loadPct: number }
  | { kind: "net"; trip: string; line: string; color: string; headsign: string; status: string; loadPct: number | null }
  | { kind: "station"; id: string; name: string; x: number; y: number }
  | { kind: "netstation"; name: string; line: string; x: number; y: number };

const NET_LAYERS = ["aera-net-track", "aera-net-track-ug", "aera-net-platforms", "aera-net-platforms-ug", "aera-net-labels"];
const NET_STATION_LAYERS = ["aera-net-platforms", "aera-net-platforms-ug"];

function netStatus(tr: NetTrain, t: number): string {
  const name = (i: number | null) => (i === null ? "" : tr.line.stops[i].name);
  if (tr.status === "dwelling" || tr.next === null) return `At ${name(tr.at)}`;
  const mins = tr.nextArrival === null ? null : Math.max(0, Math.round((tr.nextArrival - t) / 60));
  return `Next: ${name(tr.next)}${mins === null ? "" : mins === 0 ? ", arriving" : `, ${mins} min`}`;
}

function trainStatus(line: LineData, tr: LiveTrain, t: number): { headsign: string; status: string } {
  const d = line.directions.find((x) => x.direction_id === tr.state.directionId);
  const name = (i: number | null) => line.stations.find((s) => s.id === d?.stops[i ?? -1]?.station_id)?.name ?? "";
  const headsign = d?.headsign ?? "";
  if (tr.state.status === "held") return { headsign, status: `Held at ${name(tr.state.stopIndex)}` };
  if (tr.state.status === "dwelling") return { headsign, status: `At ${name(tr.state.stopIndex)}` };
  const next = tr.state.nextIndex;
  const arr = next != null ? tr.run.times[next]?.[0] : undefined;
  const mins = arr != null && Number.isFinite(arr) ? Math.max(0, Math.round((arr - t) / 60)) : null;
  return { headsign, status: `Next: ${name(next)}${mins == null ? "" : mins === 0 ? ", arriving" : `, ${mins} min`}` };
}

export function GeoMap({ line, engine, net, selected, onSelect, selectedTrain, onSelectTrain, onOtherStation, inset, onBearing, stationPeek }: {
  line: LineData; engine: CrowdEngine; selected: string | null; onSelect: (id: string) => void;
  /** TRAINS-02: timetables of every other line, drawn with their trains once loaded. */
  net: SimNetwork | null;
  /** A station of another line was tapped; `id` is its network-map station. */
  onOtherStation?: (id: string) => void;
  selectedTrain: string | null; onSelectTrain: (tripId: string) => void;
  /** Screen space covered by floating panels, in CSS pixels. */
  inset: MapInset;
  onBearing?: (deg: number) => void;
  /** Content of the hover card for a station. */
  stationPeek: (id: string) => ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const engineRef = useRef<Engine>("maplibre");
  const layerRef = useRef<TrainLayer | null>(null);
  const paintStations = useRef<() => void>(() => {});
  const relight = useRef<() => void>(() => {});
  const [ready, setReady] = useState(false);
  const is3d = useUi((s) => s.is3d);
  const cam = useUi((s) => s.cam);
  const underground = useUi((s) => s.underground);
  const liveSky = useUi((s) => s.liveSky);
  const crowdLayer = useUi((s) => s.crowdLayer);
  const otherLines = useUi((s) => s.otherLines);
  const installNet = useRef<(n: SimNetwork) => void>(() => {});
  const netRef = useRef(net);
  netRef.current = net;
  const netCrowd = useNetCrowd();
  const netCrowdRef = useRef(netCrowd);
  netCrowdRef.current = netCrowd;
  const [hover, setHover] = useState<Hover | null>(null);
  const [reduced] = useState(prefersReducedMotion);
  const padNow = useRef<PaddingOptions>({ top: 0, bottom: 0, left: 0, right: 0 });
  const padKey = useRef("");
  const prevCam = useRef(cam);
  /** Where the current selection wants the camera, re-applied when the padding changes. */
  const focus = useRef<{ center?: [number, number]; zoom: number } | null>(null);
  const cb = useRef({ onSelect, onSelectTrain, engine, onBearing, onOtherStation });
  cb.current = { onSelect, onSelectTrain, engine, onBearing, onOtherStation };
  const live = useRef({ train: selectedTrain, station: selected, cam, liveSky, underground, crowdLayer, otherLines, hover: null as string | null });
  live.current = { ...live.current, train: selectedTrain, station: selected, cam, liveSky, underground, crowdLayer, otherLines };
  const refreshCrowd = useRef<() => void>(() => {});

  useEffect(() => {
    if (!box.current || mapRef.current) return;
    let cancelled = false;
    let unsub = () => {};
    const start = async (engine: Engine) => {
      if (cancelled || !box.current) return;
      const map = await createMap(engine, box.current, line, () => !cancelled);
      if (!map) return;
      mapRef.current = map;
      engineRef.current = engine;
      // Lets headless checks drive the camera in development.
      if (process.env.NODE_ENV !== "production") (window as unknown as { __aeraMap?: MlMap }).__aeraMap = map;
      const standard = engine === "mapbox";
      const mb = standard ? (map as unknown as MapboxExtras) : null;
      map.on("rotate", () => cb.current.onBearing?.(map.getBearing()));
      let loaded = false;
      let fellBack = false;
      map.on("error", (e) => {
        const err = e.error as (Error & { url?: string; status?: number }) | undefined;
        const where = String(err?.url ?? err?.message ?? "");
        if (standard && !loaded && !fellBack && (err?.status === 401 || err?.status === 403 || where.includes("/styles/v1/"))) {
          // Token missing, refused or over its quota: carry on with the free basemap.
          fellBack = true;
          console.warn("Mapbox basemap unavailable, using the Carto basemap:", err?.message);
          setTimeout(() => {
            map.remove();
            if (mapRef.current === map) mapRef.current = null;
            void start("maplibre");
          });
        } else if (!standard && !fellBack && where.includes("style.json")) {
          fellBack = true;
          map.setStyle(fallbackStyle());
        }
      });
      // A hand on the map takes the camera back.
      for (const ev of ["dragstart", "rotatestart", "pitchstart"] as const) {
        map.on(ev, (e: { originalEvent?: Event }) => {
          if (e.originalEvent && useUi.getState().cam !== "free") useUi.getState().setCam("free");
        });
      }
      map.on("style.load", () => {
        loaded = true;
        // Standard's terrain lifts the ground under a whole-line view; the line is drawn at sea level.
        mb?.setTerrain(null);
        const targets: BasemapTarget[] = standard ? [] : quietBasemap(map);
        const palettes = new Palettes();
        let palette: Palette = palettes.at(0, 0);
        // Mapbox lights our extrusions with its own presets, so they keep their day colours there.
        const dayPalette = palette;
        let solid = palette;
        let preset: LightPreset = "day";
        const cam0 = map.cameraForBounds(coreBounds(line), { padding: padding() });
        if (cam0) map.jumpTo({ ...cam0, zoom: (cam0.zoom ?? 12) + 0.9, ...VIEW_3D });

        const colour = line.color ?? token("--accent");
        const centre = line.stations[Math.floor(line.stations.length / 2)];
        const signs = Object.fromEntries(line.directions.map((d) => [d.direction_id, travelSign(line, d.direction_id)]));
        const stopsOf = Object.fromEntries(line.directions.map((d) => [d.direction_id, d.stops]));
        const stopIdx = Object.fromEntries(line.directions.map((d) => [d.direction_id, Object.fromEntries(d.stops.map((x, i) => [x.station_id, i]))]));
        // Zoomed out, labels collide; interchanges and the ends of the line keep theirs first.
        const places = layout().placeOf;
        const rank = Object.fromEntries(line.stations.map((s, i) => {
          const p = places[s.id];
          return [s.id, i === 0 || i === line.stations.length - 1 ? 0 : p && (p.stations.length > 1 || p.hub) ? 1 : 2];
        }));
        /** Station points for labels; with loads, each carries the level of the next train leaving it. */
        const stationPoints = (loads: Record<number, (number | null)[]>): GeoJSON.FeatureCollection => ({
          type: "FeatureCollection",
          features: line.stations.map((s) => {
            const vals = line.directions.map((d) => loads[d.direction_id]?.[stopIdx[d.direction_id][s.id]]).filter((v): v is number => typeof v === "number");
            const v = vals.length ? Math.max(...vals) : null;
            return { type: "Feature", properties: { id: s.id, name: s.name, rank: rank[s.id], crowd: v === null ? "" : `\n${crowdOf(v).name}`, lv: v === null ? 0 : crowdOf(v).level },
              geometry: { type: "Point", coordinates: [s.lon, s.lat] } };
          }),
        });
        const frame = new TrackFrame(line);
        let dims = dimsAt(map.getZoom(), centre.lat);
        let builtZoom = map.getZoom();

        map.addSource("aera-track", { type: "geojson", data: trackFeatures(line, dims) });
        map.addSource("aera-platforms", { type: "geojson", data: stationFeatures(line, dims) });
        map.addSource("aera-stations", {
          type: "geojson",
          data: stationPoints({}),
        });
        map.addSource("aera-crowd", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

        const trackColour = (viaduct: string): ExpressionSpecification => ["match", ["get", "kind"], "stripe", colour, viaduct];
        const trackGlow = standard ? ["match", ["get", "kind"], "stripe", 0.9, 0.15] : undefined;
        const platformGlow = standard ? 0.6 : undefined;
        const trackLayer = (id: string, ug: boolean, opacity: number) => extrusion(id, "aera-track", ["==", ["get", "ug"], ug], trackColour(palette.viaduct), opacity, trackGlow);
        map.addLayer({ id: "aera-ug-dim", type: "background", paint: { "background-color": token("--map-underground"), "background-opacity": 0 } });
        map.addLayer(trackLayer("aera-track-ug", true, 0.45));
        map.addLayer(extrusion("aera-platforms-ug", "aera-platforms", ["==", ["get", "ug"], true], palette.station, 0.7, platformGlow));
        map.addLayer(trackLayer("aera-track", false, 1));
        map.addLayer(extrusion("aera-platforms", "aera-platforms", ["==", ["get", "ug"], false], palette.station, 1, platformGlow));
        const crowdColour: ExpressionSpecification = ["match", ["get", "level"], 1, token("--crowd-1"), 2, token("--crowd-2"), 3, token("--crowd-3"), 4, token("--crowd-4"), token("--crowd-5")];
        // Zoomed right out the bands would chop the line into coloured dashes, so they fade in
        // as the stretches get long enough to read; the trains carry crowding at every zoom.
        map.addLayer(extrusion("aera-crowd", "aera-crowd", ["has", "level"], crowdColour, ["interpolate", ["linear"], ["zoom"], 11.6, 0, 12.6, 0.95] as never, standard ? 0.85 : undefined));
        const layer = new TrainLayer(frame);
        layerRef.current = layer;
        map.addLayer(layer);
        addBuildings(map);
        const font = labelFont(map, engine);
        if (font) {
          const withCrowd = ["format", ["get", "name"], {}, ["get", "crowd"], { "font-scale": 0.78, "text-color": ["match", ["get", "lv"], 1, token("--crowd-1-ink"), 2, token("--crowd-2-ink"), 3, token("--crowd-3-ink"), 4, token("--crowd-4-ink"), token("--crowd-5-ink")] }];
          map.addLayer({ id: "aera-station-labels", type: "symbol", source: "aera-stations", minzoom: 10.2,
            layout: {
              // Names only when zoomed out; the crowding word joins once there is room.
              "text-field": ["step", ["zoom"], ["get", "name"], LABEL_CROWD_ZOOM, withCrowd] as never,
              "text-font": font, "text-size": ["interpolate", ["linear"], ["zoom"], 10, 11, 12, 12, 15, 14.5],
              "symbol-sort-key": ["get", "rank"], "text-variable-anchor": ["left", "right"], "text-radial-offset": 0.9, "text-justify": "auto",
            },
            paint: { "text-color": palette.ink, "text-halo-color": palette.halo, "text-halo-width": 2, ...(standard ? { "text-emissive-strength": 1 } : {}) } as never });
        }

        // TRAINS-02: every other line and its trains, once their timetables have loaded.
        const lay = layout();
        const colours = Object.fromEntries(LINES.map((l) => [l.id, token(l.color)]));
        const kjNames = new Set(line.stations.map((s) => s.name));
        const mapId = (sl: SimLine, k: number) => stationFor(lay, sl.id, sl.stops[k])?.id ?? null;
        const netColour = (viaduct: string): ExpressionSpecification => ["match", ["get", "kind"], "stripe", ["get", "color"], viaduct];
        let netLines: { line: SimLine; frame: TrackFrame }[] = [];
        let netNow: NetTrain[] = [];
        let netDims = dims;
        installNet.current = (n) => {
          if (netLines.length) return;
          const lines = n.lines.filter((l) => l.shape.length >= 2);
          netLines = lines.map((l) => ({ line: l, frame: new TrackFrame(asTrack(l), frame) }));
          netDims = dims;
          map.addSource("aera-net-track", { type: "geojson", data: netTrackFeatures(lines, dims, colours) });
          map.addSource("aera-net-platforms", { type: "geojson", data: netStationFeatures(lines, dims, mapId) });
          map.addSource("aera-net-stations", { type: "geojson", data: netStationPoints(lines, kjNames) });
          map.addLayer(extrusion("aera-net-track-ug", "aera-net-track", ["==", ["get", "ug"], true], netColour(solid.viaduct), 0.4, trackGlow), "aera-track-ug");
          map.addLayer(extrusion("aera-net-platforms-ug", "aera-net-platforms", ["==", ["get", "ug"], true], solid.station, 0.6, platformGlow), "aera-track-ug");
          map.addLayer(extrusion("aera-net-track", "aera-net-track", ["==", ["get", "ug"], false], netColour(solid.viaduct), 1, trackGlow), "aera-track");
          map.addLayer(extrusion("aera-net-platforms", "aera-net-platforms", ["==", ["get", "ug"], false], solid.station, 1, platformGlow), "aera-track");
          if (font) {
            map.addLayer({ id: "aera-net-labels", type: "symbol", source: "aera-net-stations", minzoom: 12.6,
              layout: { "text-field": ["get", "name"], "text-font": font, "text-size": ["interpolate", ["linear"], ["zoom"], 12.6, 11, 16, 13], "text-offset": [1, 0], "text-anchor": "left" },
              paint: { "text-color": palette.ink, "text-halo-color": palette.halo, "text-halo-width": 2, "text-opacity": 0.85, ...(standard ? { "text-emissive-strength": 1 } : {}) } as never },
              map.getLayer("aera-station-labels") ? "aera-station-labels" : undefined);
          }
          const vis = live.current.otherLines ? "visible" : "none";
          for (const id of NET_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
          if (live.current.underground) {
            map.setPaintProperty("aera-net-track", "fill-extrusion-opacity", 0.22);
            map.setPaintProperty("aera-net-platforms", "fill-extrusion-opacity", 0.3);
            map.setPaintProperty("aera-net-track-ug", "fill-extrusion-opacity", 1);
          }
          relight.current();
        };
        if (netRef.current) installNet.current(netRef.current);

        paintStations.current = () => {
          const c: ExpressionSpecification = ["case", ["==", ["get", "id"], live.current.station ?? ""], token("--accent"), solid.station];
          for (const l of STATION_LAYERS) if (map.getLayer(l)) map.setPaintProperty(l, "fill-extrusion-color", c);
        };

        // Sun and sky. Repainted only when the light has moved enough to see.
        let lit = { night: -1, dusk: -1, az: -999 };
        const light = (sun: SunPos, dl: Daylight) => {
          if (Math.abs(dl.night - lit.night) < 0.015 && Math.abs(dl.dusk - lit.dusk) < 0.03 && Math.abs(sun.azimuth - lit.az) < 2) return;
          lit = { night: dl.night, dusk: dl.dusk, az: sun.azimuth };
          palette = palettes.at(dl.night, dl.dusk);
          if (mb) {
            solid = dayPalette;
            const next = lightPreset(dl);
            if (next !== preset) {
              preset = next;
              mb.setConfigProperty("basemap", "lightPreset", next);
            }
          } else {
            solid = palette;
            paintBasemap(map, targets, palette);
            map.setSky({
              "sky-color": palette.sky, "horizon-color": palette.horizon, "fog-color": palette.fog,
              "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.8, "fog-ground-blend": 0.6, "atmosphere-blend": 0,
            });
            const warm = dl.dusk > 0.5 ? "#ffeedd" : dl.night > 0.5 ? "#c4cdff" : "#ffffff";
            map.setLight({
              anchor: "map", color: warm, intensity: 0.42 - 0.2 * dl.night,
              position: [1.3, sun.altitude > 0 ? sun.azimuth : 200, Math.min(80, Math.max(15, 90 - sun.altitude))],
            });
          }
          for (const id of ["aera-track", "aera-track-ug"]) map.setPaintProperty(id, "fill-extrusion-color", trackColour(solid.viaduct));
          for (const id of ["aera-net-track", "aera-net-track-ug"]) if (map.getLayer(id)) map.setPaintProperty(id, "fill-extrusion-color", netColour(solid.viaduct));
          for (const id of NET_STATION_LAYERS) if (map.getLayer(id)) map.setPaintProperty(id, "fill-extrusion-color", solid.station);
          if (map.getLayer("aera-net-labels")) {
            const p = live.current.underground ? palettes.at(1, 0) : palette;
            map.setPaintProperty("aera-net-labels", "text-color", p.ink);
            map.setPaintProperty("aera-net-labels", "text-halo-color", p.halo);
          }
          if (map.getLayer("aera-buildings")) map.setPaintProperty("aera-buildings", "fill-extrusion-color", palette.building);
          if (map.getLayer("aera-station-labels")) {
            // Underground mode darkens the map, so labels take their night colours.
            const p = live.current.underground ? palettes.at(1, 0) : palette;
            map.setPaintProperty("aera-station-labels", "text-color", p.ink);
            map.setPaintProperty("aera-station-labels", "text-halo-color", p.halo);
          }
          paintStations.current();
          layer.setSun(sun, dl.night);
        };

        relight.current = () => {
          lit = { night: -1, dusk: -1, az: -999 };
        };

        const pickRadius = () => (window.matchMedia("(pointer: coarse)").matches ? 22 : 12);
        map.on("click", (e) => {
          const trip = layer.pick(e.point.x, e.point.y, pickRadius());
          if (trip) return cb.current.onSelectTrain(trip);
          const stop = map.queryRenderedFeatures(e.point, { layers: STATION_LAYERS })[0];
          if (stop?.properties?.id) return cb.current.onSelect(String(stop.properties.id));
          const other = netLines.length && live.current.otherLines ? map.queryRenderedFeatures(e.point, { layers: NET_STATION_LAYERS })[0] : null;
          if (other?.properties?.id) cb.current.onOtherStation?.(String(other.properties.id));
        });
        map.on("mousemove", (e) => {
          const trip = layer.pick(e.point.x, e.point.y, 10);
          live.current.hover = trip;
          if (trip) {
            map.getCanvas().style.cursor = "pointer";
            return;
          }
          const stop = map.queryRenderedFeatures(e.point, { layers: STATION_LAYERS })[0];
          const other = !stop && netLines.length && live.current.otherLines ? map.queryRenderedFeatures(e.point, { layers: NET_STATION_LAYERS })[0] : null;
          map.getCanvas().style.cursor = stop || other ? "pointer" : "";
          setHover(stop?.properties?.id
            ? { kind: "station", id: String(stop.properties.id), name: String(stop.properties.name), x: e.point.x, y: e.point.y }
            : other ? { kind: "netstation", name: String(other.properties?.name ?? ""), line: String(other.properties?.line ?? ""), x: e.point.x, y: e.point.y }
              : null);
        });
        map.on("mouseout", () => {
          live.current.hover = null;
          setHover(null);
        });

        // Sizes follow the zoom, so the fixed geometry is rebuilt when the zoom moves on.
        map.on("zoom", () => {
          if (Math.abs(map.getZoom() - builtZoom) < 0.08) return;
          builtZoom = map.getZoom();
          dims = dimsAt(builtZoom, centre.lat);
          (map.getSource("aera-track") as GeoJSONSource | undefined)?.setData(trackFeatures(line, dims));
          (map.getSource("aera-platforms") as GeoJSONSource | undefined)?.setData(stationFeatures(line, dims));
          if (netLines.length && netDims !== dims) {
            netDims = dims;
            const lines = netLines.map((x) => x.line);
            (map.getSource("aera-net-track") as GeoJSONSource | undefined)?.setData(netTrackFeatures(lines, dims, colours));
            (map.getSource("aera-net-platforms") as GeoJSONSource | undefined)?.setData(netStationFeatures(lines, dims, mapId));
          }
        });

        // MAPC-01, NET-04: crowding on the track and the next train's level at each station.
        let crowdAt = 0;
        let crowdDims = dims;
        const loadsNow = (t: number) => {
          const st = useTwin.getState();
          const disruptions = st.sim?.disruptions ?? [];
          const mult = st.sim?.scenario.demand_mult ?? 1;
          const eng = cb.current.engine;
          const blocks = blocksAt(eng, disruptions, t);
          // Stretches trains cannot pass get no band: nothing runs there now.
          return Object.fromEntries(line.directions.map((d) => [d.direction_id, eng.stretchLoads(d.direction_id, t, disruptions, mult)
            .map((v, k) => (blocks.some((b) => b.dir === d.direction_id && eng.segment(d.direction_id, k) >= b.lo && eng.segment(d.direction_id, k) < b.hi) ? null : v))]));
        };
        refreshCrowd.current = () => {
          crowdAt = 0;
        };
        const paintCrowd = (t: number) => {
          crowdAt = performance.now();
          crowdDims = dims;
          const on = live.current.crowdLayer;
          const loads = on ? loadsNow(t) : {};
          (map.getSource("aera-crowd") as GeoJSONSource | undefined)?.setData(on ? crowdFeatures(line, dims, loads, (v) => crowdOf(v).level) : { type: "FeatureCollection", features: [] });
          (map.getSource("aera-stations") as GeoJSONSource | undefined)?.setData(stationPoints(loads));
        };

        const accent = token("--accent");
        const held = token("--status-critical");
        const late = token("--status-serious");
        const lv = [1, 2, 3, 4, 5].map((n) => token(`--crowd-${n}`));
        const animate = !prefersReducedMotion();
        let lastWall = performance.now();
        let hoverKey = "";
        unsub = subscribe((f) => {
          const now = performance.now();
          const dt = Math.min(0.1, (now - lastWall) / 1000);
          lastWall = now;
          const { train: sel, cam: mode, liveSky: sky, hover: hov } = live.current;

          if (now - crowdAt > CROWD_REFRESH_MS || crowdDims !== dims) paintCrowd(f.t);

          const sun = sky ? sunPosition(f.t * 1000, centre.lat, centre.lon) : NOON;
          const dl = daylight(sun);
          light(sun, dl);

          const draws: TrainDraw[] = f.trains.map((tr) => {
            const dir = tr.state.directionId;
            const isSel = tr.run.trip.id === sel;
            // Up close (chase, orbit) the beacon and halo would hide the train itself.
            const close = isSel && (mode === "chase" || mode === "orbit");
            const k = tr.state.stopIndex;
            const lateS = tr.run.times[k][0] - (tr.run.trip.start + (stopsOf[dir]?.[k]?.arr ?? 0));
            return {
              trip: tr.run.trip.id,
              cars: carPoses(frame, dims, tr.state.distanceM, signs[dir] ?? 1),
              colours: cb.current.engine.carLoads(tr.loadPct, dir).map((p) => lv[crowdOf(p).level - 1]),
              marker: close ? null : isSel ? accent : tr.state.status === "held" ? held : lateS > LATE_S ? late : null,
              selected: isSel && !close,
            };
          });
          netNow = [];
          if (live.current.otherLines) {
            for (const { line: sl, frame: fr } of netLines) {
              for (const tr of trainsAt(sl, f.t)) {
                netNow.push(tr);
                const isSel = tr.id === sel;
                const close = isSel && (mode === "chase" || mode === "orbit");
                const pose = netCarPoses(fr, sl, dims, tr);
                const load = netTrainLoad(netCrowdRef.current, tr, f.t);
                draws.push({ trip: tr.id, cars: pose.cars, colours: [], marker: close ? null : isSel ? accent : null, selected: isSel && !close,
                  box: { color: colours[sl.id] ?? sl.color ?? "#888888", carLength: pose.carLength, width: pose.width, height: pose.height,
                    roof: load === null ? undefined : lv[crowdOf(load).level - 1] } });
              }
            }
          }
          layer.update(draws, dims, now / 1000, animate);
          map.triggerRepaint();

          // Hover card: content changes rarely, position every frame.
          if (hov && isNetTrain(hov)) {
            const nt = netNow.find((x) => x.id === hov);
            const at = nt && layer.anchor(hov);
            if (nt && at) {
              const def = LINES.find((l) => l.id === nt.line.id);
              const status = netStatus(nt, f.t);
              const load = netTrainLoad(netCrowdRef.current, nt, f.t);
              const key = `${hov}|${status}|${load === null ? "" : crowdOf(load).level}`;
              if (key !== hoverKey) {
                hoverKey = key;
                setHover({ kind: "net", trip: hov, line: def?.name ?? nt.line.name, color: colours[nt.line.id] ?? "#888", headsign: nt.headsign, status, loadPct: load });
              }
              if (tip.current) {
                tip.current.style.transform = `translate(${at[0]}px, ${at[1]}px) translate(-50%, calc(-100% - 10px))`;
                tip.current.style.opacity = "1";
              }
            } else if (hoverKey) {
              hoverKey = "";
              live.current.hover = null;
              setHover(null);
            }
          } else if (hov) {
            const tr = f.trains.find((x) => x.run.trip.id === hov);
            const at = tr && layer.anchor(hov);
            if (tr && at) {
              const s = trainStatus(line, tr, f.t);
              const key = `${hov}|${s.status}|${crowdOf(tr.loadPct).level}|${Math.floor(tr.loadPct)}`;
              if (key !== hoverKey) {
                hoverKey = key;
                setHover({ kind: "train", trip: hov, ...s, loadPct: tr.loadPct });
              }
              if (tip.current) {
                tip.current.style.transform = `translate(${at[0]}px, ${at[1]}px) translate(-50%, calc(-100% - 10px))`;
                tip.current.style.opacity = "1";
              }
            } else if (hoverKey) {
              hoverKey = "";
              live.current.hover = null;
              setHover(null);
            }
          } else if (hoverKey) {
            hoverKey = "";
            setHover((h) => (h?.kind === "train" || h?.kind === "net" ? null : h));
          }

          // Camera modes for the selected train.
          if (!sel || mode === "free" || map.isMoving()) return;
          let center: [number, number];
          let tangent: () => { tx: number; ty: number };
          let sign: number;
          if (isNetTrain(sel)) {
            const nt = netNow.find((x) => x.id === sel);
            const nl = nt && netLines.find((x) => x.line === nt.line);
            if (!nt || !nl) return;
            center = lonLatAt(nt.line, nt.d);
            tangent = () => nl.frame.at(nt.d);
            sign = nt.sign;
          } else {
            const tr = f.trains.find((x) => x.run.trip.id === sel);
            if (!tr) return;
            const p = pointAt(line, tr.state.distanceM);
            center = [p.lon, p.lat];
            tangent = () => frame.at(tr.state.distanceM);
            sign = signs[tr.state.directionId] ?? 1;
          }
          if (mode === "follow") return map.setCenter(center);
          let bearing = map.getBearing();
          if (mode === "chase") {
            const t = tangent();
            const target = (Math.atan2(t.tx * sign, t.ty * sign) * 180) / Math.PI;
            const delta = ((((target - bearing) % 360) + 540) % 360) - 180;
            bearing += delta * (1 - Math.exp(-dt * 2.5));
          } else {
            bearing += dt * 9;
          }
          map.jumpTo({ center, bearing });
        });
        const stationById = Object.fromEntries(line.stations.map((s) => [s.id, s]));
        mapApi.current = {
          zoomBy: (delta) => map.easeTo({ zoom: map.getZoom() + delta, duration: prefersReducedMotion() ? 0 : 300 }),
          resetNorth: () => map.easeTo({ bearing: 0, duration: prefersReducedMotion() ? 0 : 500 }),
          wholeLine: () => {
            useUi.getState().setCam("free");
            const c = map.cameraForBounds(lineBounds(line), { padding: 40 });
            if (c) map.easeTo({ ...c, bearing: map.getBearing(), pitch: map.getPitch(), duration: prefersReducedMotion() ? 0 : 900 });
          },
          showStretch: (fromId, toId) => {
            const a = stationById[fromId];
            const b = stationById[toId];
            if (!a || !b) return;
            useUi.getState().setCam("free");
            const c = map.cameraForBounds([[Math.min(a.lon, b.lon), Math.min(a.lat, b.lat)], [Math.max(a.lon, b.lon), Math.max(a.lat, b.lat)]], { padding: 80 });
            if (c) map.easeTo({ ...c, zoom: Math.min(c.zoom ?? 15, 15.5), bearing: map.getBearing(), pitch: map.getPitch(), duration: prefersReducedMotion() ? 0 : 900 });
          },
        };
        setReady(true);
      });
    };
    void start(MAPBOX_TOKEN ? "mapbox" : "maplibre");
    return () => {
      cancelled = true;
      unsub();
      mapApi.current = null;
      layerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [line]);

  // Panels cover part of the map; keep the selection in the part that shows. Chase also wants
  // the train low in the view.
  const { top, bottom, left, right } = inset;
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const h = map.getCanvas().clientHeight;
    const pad: PaddingOptions = { top: top + (cam === "chase" ? (h - top - bottom) * 0.3 : 0), bottom, left, right };
    const close = cam === "chase" || cam === "orbit";
    const wasClose = prevCam.current === "chase" || prevCam.current === "orbit";
    const key = JSON.stringify(pad);
    prevCam.current = cam;
    padNow.current = pad;
    // Free and follow share a padding; switching between them must not cancel a fly-to.
    if (close) {
      map.easeTo({ padding: pad, pitch: cam === "chase" ? 74 : 62, zoom: Math.max(map.getZoom(), cam === "chase" ? 19.6 : 18), duration: reduced ? 0 : 900 });
    } else if (key !== padKey.current || wasClose) {
      map.easeTo({ padding: pad, ...(focus.current ?? {}), duration: reduced ? 0 : 400 });
    }
    padKey.current = key;
  }, [ready, cam, reduced, top, bottom, left, right]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    paintStations.current();
    const s = line.stations.find((x) => x.id === selected);
    if (!s) return;
    focus.current = { center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 15) };
    map.easeTo({ ...focus.current, padding: padNow.current, duration: reduced ? 0 : 800 });
  }, [ready, selected, line, reduced]);

  // Picking a train flies to it and keeps it centred until the map is dragged.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const tr = latest.trains.find((x) => x.run.trip.id === selectedTrain);
    const nt = !tr && isNetTrain(selectedTrain) && netRef.current ? findTrain(netRef.current, selectedTrain!, latest.t) : null;
    if (!tr && !nt) {
      if (!selected) focus.current = null;
      return;
    }
    let center: [number, number];
    if (tr) {
      const p = pointAt(line, tr.state.distanceM);
      center = [p.lon, p.lat];
    } else center = lonLatAt(nt!.line, nt!.d);
    // A train keeps moving, so only its zoom is kept; follow mode keeps it centred.
    focus.current = { zoom: Math.max(map.getZoom(), 16.3) };
    map.easeTo({ center, ...focus.current, padding: padNow.current, duration: reduced ? 0 : 900 });
  }, [ready, selectedTrain, selected, line, reduced, net]);

  // TRAINS-02: draw the other lines once their timetables arrive, and show or hide them.
  useEffect(() => {
    if (ready && net) installNet.current(net);
  }, [ready, net]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const id of NET_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", otherLines ? "visible" : "none");
    map.triggerRepaint();
  }, [ready, otherLines, net]);


  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const show = is3d && !underground;
    if (engineRef.current === "mapbox") (map as unknown as MapboxExtras).setConfigProperty("basemap", "show3dObjects", show);
    else if (map.getLayer("aera-buildings")) map.setLayoutProperty("aera-buildings", "visibility", show ? "visible" : "none");
  }, [ready, is3d, underground]);

  // Tilt only when the 3D switch changes; the map already opens in 3D.
  const shown3d = useRef(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || shown3d.current === is3d) return;
    shown3d.current = is3d;
    if (live.current.cam === "chase" || live.current.cam === "orbit") return;
    map.easeTo({ ...(is3d ? VIEW_3D : VIEW_2D), duration: reduced ? 0 : 700 });
  }, [ready, is3d, reduced]);

  // POL-07: tour the line station to station, until it reaches the end or a hand takes the map.
  const touring = useUi((s) => s.touring);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !touring) return;
    const stops = TOUR.map((id) => line.stations.find((s) => s.id === id)).filter((s): s is LineData["stations"][number] => !!s);
    let i = 0;
    let timer = 0;
    let done = false;
    const next = () => {
      if (done) return;
      if (i >= stops.length) return useUi.getState().setTouring(false);
      const s = stops[i];
      // Face the way the tour is going: towards the next stop, or on from the last one.
      const [a, b] = i < stops.length - 1 ? [s, stops[i + 1]] : [stops[i - 1], s];
      const bearing = (Math.atan2((b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180), b.lat - a.lat) * 180) / Math.PI;
      useUi.getState().setTourAt(s.id);
      // Listen first: with no animation the move ends inside easeTo.
      map.once("moveend", () => {
        if (!done) timer = window.setTimeout(next, reduced ? 2500 : 1100);
      });
      map.easeTo({ center: [s.lon, s.lat], zoom: 15.4, pitch: 62, bearing, padding: padNow.current, duration: reduced ? 0 : i === 0 ? 2600 : 5200 });
      i++;
    };
    const stop = (e: { originalEvent?: Event }) => {
      if (e.originalEvent) useUi.getState().setTouring(false);
    };
    const events = ["dragstart", "rotatestart", "pitchstart", "zoomstart"] as const;
    for (const ev of events) map.on(ev, stop);
    next();
    return () => {
      done = true;
      window.clearTimeout(timer);
      for (const ev of events) map.off(ev, stop);
      map.stop();
    };
  }, [ready, touring, line, reduced]);

  useEffect(() => {
    if (ready) refreshCrowd.current();
  }, [ready, crowdLayer]);

  // Underground: dim the surface, fade the viaduct and surface trains, bring the tunnel up.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setPaintProperty("aera-ug-dim", "background-opacity", underground ? 0.72 : 0);
    map.setPaintProperty("aera-track", "fill-extrusion-opacity", underground ? 0.22 : 1);
    map.setPaintProperty("aera-platforms", "fill-extrusion-opacity", underground ? 0.3 : 1);
    map.setPaintProperty("aera-track-ug", "fill-extrusion-opacity", underground ? 1 : 0.45);
    map.setPaintProperty("aera-platforms-ug", "fill-extrusion-opacity", underground ? 1 : 0.7);
    if (map.getLayer("aera-net-track")) {
      map.setPaintProperty("aera-net-track", "fill-extrusion-opacity", underground ? 0.22 : 1);
      map.setPaintProperty("aera-net-platforms", "fill-extrusion-opacity", underground ? 0.3 : 1);
      map.setPaintProperty("aera-net-track-ug", "fill-extrusion-opacity", underground ? 1 : 0.4);
      map.setPaintProperty("aera-net-platforms-ug", "fill-extrusion-opacity", underground ? 1 : 0.6);
    }
    layerRef.current?.setUnderground(underground);
    relight.current();
    map.triggerRepaint();
  }, [ready, underground]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={box} className="h-full w-full" role="region" aria-label="3D map of the Kelana Jaya Line with trains and track coloured by crowding. The line list button gives the same information as text." />
      {!ready && (
        <div className="pointer-events-none absolute inset-x-0 top-[38%] flex justify-center">
          <p role="status" className="enter flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-[13px] font-semibold text-ink-2 shadow-card">
            <Subway size={16} weight="fill" className="text-accent" aria-hidden />Loading the 3D map
          </p>
        </div>
      )}
      {hover && (
        <div ref={tip} key={hover.kind} aria-hidden className={`pointer-events-none absolute ${hover.kind === "train" || hover.kind === "net" ? "opacity-0 px-3.5 py-2.5" : ""} ${hover.kind === "netstation" ? "px-3.5 py-2.5" : ""} left-0 top-0 z-10 w-max max-w-[280px] overflow-hidden rounded-2xl bg-white shadow-float`}
          style={hover.kind === "station" || hover.kind === "netstation" ? { transform: `translate(${hover.x}px, ${hover.y}px) translate(-50%, calc(-100% - 14px))` } : undefined}>
          {hover.kind === "net" ? (
            <>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-2"><span className="h-2 w-2 rounded-full" style={{ background: hover.color }} />{hover.line}</p>
              <p className="text-[15px] font-extrabold leading-tight text-ink">To {hover.headsign}</p>
              <p className="mt-0.5 text-xs text-ink-2">{hover.status}</p>
              {hover.loadPct !== null ? (
                <div className="mt-2 flex items-center gap-1.5"><CrowdTag loadPct={hover.loadPct} size="sm" /><span className="text-[11px] text-ink-3">at this time, usually</span></div>
              ) : <p className="mt-1 text-[11px] text-ink-3">From the timetable. No crowding data for this line.</p>}
            </>
          ) : hover.kind === "netstation" ? (
            <>
              <p className="text-[15px] font-extrabold leading-tight text-ink">{hover.name}</p>
              <p className="mt-0.5 text-xs text-ink-2">{LINES.find((l) => l.id === hover.line)?.name ?? hover.line}. Tap for its trains on the network map.</p>
            </>
          ) : hover.kind === "train" ? (
            <>
              <p className="text-[11px] font-semibold text-accent">Train to</p>
              <p className="text-[15px] font-extrabold leading-tight text-ink">{hover.headsign}</p>
              <p className="mt-0.5 text-xs text-ink-2">{hover.status}</p>
              <div className="mt-2"><CrowdTag loadPct={hover.loadPct} size="sm" showPct /></div>
            </>
          ) : (
            stationPeek(hover.id)
          )}
        </div>
      )}
    </div>
  );
}
