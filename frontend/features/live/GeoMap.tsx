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
 * The map fills the screen (MAP-01). Its switches live in the UI store and its buttons float
 * over it (LiveView), which drives it through `mapApi`. `inset` keeps the selection clear of
 * the card or bottom sheet that covers part of the map (MAP-05).
 */

import type { ExpressionSpecification, GeoJSONSource, Map as MlMap, PaddingOptions, StyleSpecification } from "maplibre-gl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { CrowdTag } from "@/components/Crowd";
import { crowdOf } from "@/lib/crowd/levels";
import { type LiveTrain, latest, subscribe } from "@/lib/crowd/feed";
import type { CrowdEngine } from "@/lib/crowd/model";
import { lineBounds, pointAt } from "@/lib/sim/geo";
import { type Daylight, type Sun as SunPos, daylight, sunPosition } from "@/lib/sim/sun";
import { prefersReducedMotion, token } from "@/lib/theme";
import type { LineData } from "@/lib/types";
import { useUi } from "@/lib/ui";
import { type BasemapTarget, type Palette, Palettes, paintBasemap, quietBasemap } from "./daylight";
import { TrackFrame, carPoses, dimsAt, stationFeatures, trackFeatures, travelSign } from "./geo3d";
import { type TrainDraw, TrainLayer } from "./trainLayer";

const STYLE_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const CREDIT = "Timetable © Prasarana GTFS, ridership data.gov.my";

function fallbackStyle(): StyleSpecification {
  return { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": token("--map-bg") } }] };
}

/** An upright font the basemap already serves (water labels use italics). */
function labelFont(map: MlMap): string[] | null {
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

function extrusion(id: string, source: string, filter: unknown[], color: unknown, opacity: number) {
  return {
    id, type: "fill-extrusion" as const, source, filter: filter as never,
    paint: {
      "fill-extrusion-color": color as never,
      "fill-extrusion-base": ["get", "base"] as never,
      "fill-extrusion-height": ["get", "top"] as never,
      "fill-extrusion-opacity": opacity,
      "fill-extrusion-vertical-gradient": true,
    },
  };
}

const STATION_LAYERS = ["aera-platforms", "aera-platforms-ug"];

type Hover =
  | { kind: "train"; trip: string; headsign: string; status: string; loadPct: number }
  | { kind: "station"; id: string; name: string; x: number; y: number };

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

export function GeoMap({ line, engine, selected, onSelect, selectedTrain, onSelectTrain, inset, onBearing, stationPeek }: {
  line: LineData; engine: CrowdEngine; selected: string | null; onSelect: (id: string) => void;
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
  const layerRef = useRef<TrainLayer | null>(null);
  const paintStations = useRef<() => void>(() => {});
  const relight = useRef<() => void>(() => {});
  const [ready, setReady] = useState(false);
  const is3d = useUi((s) => s.is3d);
  const cam = useUi((s) => s.cam);
  const underground = useUi((s) => s.underground);
  const liveSky = useUi((s) => s.liveSky);
  const [hover, setHover] = useState<Hover | null>(null);
  const [reduced] = useState(prefersReducedMotion);
  const padNow = useRef<PaddingOptions>({ top: 0, bottom: 0, left: 0, right: 0 });
  const padKey = useRef("");
  const prevCam = useRef(cam);
  /** Where the current selection wants the camera, re-applied when the padding changes. */
  const focus = useRef<{ center?: [number, number]; zoom: number } | null>(null);
  const cb = useRef({ onSelect, onSelectTrain, engine, onBearing });
  cb.current = { onSelect, onSelectTrain, engine, onBearing };
  const live = useRef({ train: selectedTrain, station: selected, cam, liveSky, underground, hover: null as string | null });
  live.current = { ...live.current, train: selectedTrain, station: selected, cam, liveSky, underground };

  useEffect(() => {
    if (!box.current || mapRef.current) return;
    let cancelled = false;
    let unsub = () => {};
    (async () => {
      const ml = await import("maplibre-gl");
      if (cancelled || !box.current) return;
      ml.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      const map = new ml.Map({
        container: box.current,
        style: STYLE_LIGHT,
        bounds: lineBounds(line),
        fitBoundsOptions: { padding: padding() },
        attributionControl: { compact: true, customAttribution: CREDIT },
        maxPitch: 78,
        canvasContextAttributes: { antialias: true },
      });
      mapRef.current = map;
      map.on("rotate", () => cb.current.onBearing?.(map.getBearing()));
      let fellBack = false;
      map.on("error", (e) => {
        const err = e.error as (Error & { url?: string }) | undefined;
        if (!fellBack && String(err?.url ?? err?.message ?? "").includes("style.json")) {
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
        const targets: BasemapTarget[] = quietBasemap(map);
        const palettes = new Palettes();
        let palette: Palette = palettes.at(0, 0);
        const cam0 = map.cameraForBounds(coreBounds(line), { padding: padding() });
        if (cam0) map.jumpTo({ ...cam0, zoom: (cam0.zoom ?? 12) + 0.9, ...VIEW_3D });

        const colour = line.color ?? token("--accent");
        const centre = line.stations[Math.floor(line.stations.length / 2)];
        const signs = Object.fromEntries(line.directions.map((d) => [d.direction_id, travelSign(line, d.direction_id)]));
        const frame = new TrackFrame(line);
        let dims = dimsAt(map.getZoom(), centre.lat);
        let builtZoom = map.getZoom();

        map.addSource("aera-track", { type: "geojson", data: trackFeatures(line, dims) });
        map.addSource("aera-platforms", { type: "geojson", data: stationFeatures(line, dims) });
        map.addSource("aera-stations", {
          type: "geojson",
          data: { type: "FeatureCollection", features: line.stations.map((s) => ({ type: "Feature", properties: { id: s.id, name: s.name }, geometry: { type: "Point", coordinates: [s.lon, s.lat] } })) },
        });

        const trackColour = (viaduct: string): ExpressionSpecification => ["match", ["get", "kind"], "stripe", colour, viaduct];
        const trackLayer = (id: string, ug: boolean, opacity: number) => extrusion(id, "aera-track", ["==", ["get", "ug"], ug], trackColour(palette.viaduct), opacity);
        map.addLayer({ id: "aera-ug-dim", type: "background", paint: { "background-color": token("--map-underground"), "background-opacity": 0 } });
        map.addLayer(trackLayer("aera-track-ug", true, 0.45));
        map.addLayer(extrusion("aera-platforms-ug", "aera-platforms", ["==", ["get", "ug"], true], palette.station, 0.7));
        map.addLayer(trackLayer("aera-track", false, 1));
        map.addLayer(extrusion("aera-platforms", "aera-platforms", ["==", ["get", "ug"], false], palette.station, 1));
        const layer = new TrainLayer(frame);
        layerRef.current = layer;
        map.addLayer(layer);
        addBuildings(map);
        const font = labelFont(map);
        if (font) {
          map.addLayer({ id: "aera-station-labels", type: "symbol", source: "aera-stations", minzoom: 11.5,
            layout: { "text-field": ["get", "name"], "text-font": font, "text-size": ["interpolate", ["linear"], ["zoom"], 11, 12, 15, 14.5], "text-offset": [1.2, 0], "text-anchor": "left" },
            paint: { "text-color": palette.ink, "text-halo-color": palette.halo, "text-halo-width": 2 } });
        }

        paintStations.current = () => {
          const c: ExpressionSpecification = ["case", ["==", ["get", "id"], live.current.station ?? ""], token("--accent"), palette.station];
          for (const l of STATION_LAYERS) if (map.getLayer(l)) map.setPaintProperty(l, "fill-extrusion-color", c);
        };

        // Sun and sky. Repainted only when the light has moved enough to see.
        let lit = { night: -1, dusk: -1, az: -999 };
        const light = (sun: SunPos, dl: Daylight) => {
          if (Math.abs(dl.night - lit.night) < 0.015 && Math.abs(dl.dusk - lit.dusk) < 0.03 && Math.abs(sun.azimuth - lit.az) < 2) return;
          lit = { night: dl.night, dusk: dl.dusk, az: sun.azimuth };
          palette = palettes.at(dl.night, dl.dusk);
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
          for (const id of ["aera-track", "aera-track-ug"]) map.setPaintProperty(id, "fill-extrusion-color", trackColour(palette.viaduct));
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
          if (stop?.properties?.id) cb.current.onSelect(String(stop.properties.id));
        });
        map.on("mousemove", (e) => {
          const trip = layer.pick(e.point.x, e.point.y, 10);
          live.current.hover = trip;
          if (trip) {
            map.getCanvas().style.cursor = "pointer";
            return;
          }
          const stop = map.queryRenderedFeatures(e.point, { layers: STATION_LAYERS })[0];
          map.getCanvas().style.cursor = stop ? "pointer" : "";
          setHover(stop?.properties?.id
            ? { kind: "station", id: String(stop.properties.id), name: String(stop.properties.name), x: e.point.x, y: e.point.y }
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
        });

        const accent = token("--accent");
        const held = token("--status-critical");
        const lv = [1, 2, 3, 4, 5].map((n) => token(`--crowd-${n}`));
        const animate = !prefersReducedMotion();
        let lastWall = performance.now();
        let hoverKey = "";
        unsub = subscribe((f) => {
          const now = performance.now();
          const dt = Math.min(0.1, (now - lastWall) / 1000);
          lastWall = now;
          const { train: sel, cam: mode, liveSky: sky, hover: hov } = live.current;

          const sun = sky ? sunPosition(f.t * 1000, centre.lat, centre.lon) : NOON;
          const dl = daylight(sun);
          light(sun, dl);

          const draws: TrainDraw[] = f.trains.map((tr) => {
            const dir = tr.state.directionId;
            const isSel = tr.run.trip.id === sel;
            // Up close (chase, orbit) the beacon and halo would hide the train itself.
            const close = isSel && (mode === "chase" || mode === "orbit");
            return {
              trip: tr.run.trip.id,
              cars: carPoses(frame, dims, tr.state.distanceM, signs[dir] ?? 1),
              colours: cb.current.engine.carLoads(tr.loadPct, dir).map((p) => lv[crowdOf(p).level - 1]),
              marker: close ? null : isSel ? accent : tr.state.status === "held" ? held : null,
              selected: isSel && !close,
            };
          });
          layer.update(draws, dims, now / 1000, animate);
          map.triggerRepaint();

          // Hover card: content changes rarely, position every frame.
          if (hov) {
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
            setHover((h) => (h?.kind === "train" ? null : h));
          }

          // Camera modes for the selected train.
          if (!sel || mode === "free" || map.isMoving()) return;
          const tr = f.trains.find((x) => x.run.trip.id === sel);
          if (!tr) return;
          const p = pointAt(line, tr.state.distanceM);
          const center: [number, number] = [p.lon, p.lat];
          if (mode === "follow") return map.setCenter(center);
          let bearing = map.getBearing();
          if (mode === "chase") {
            const sign = signs[tr.state.directionId] ?? 1;
            const t = frame.at(tr.state.distanceM);
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
    })();
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
    if (!tr) {
      if (!selected) focus.current = null;
      return;
    }
    const p = pointAt(line, tr.state.distanceM);
    // A train keeps moving, so only its zoom is kept; follow mode keeps it centred.
    focus.current = { zoom: Math.max(map.getZoom(), 16.3) };
    map.easeTo({ center: [p.lon, p.lat], ...focus.current, padding: padNow.current, duration: reduced ? 0 : 900 });
  }, [ready, selectedTrain, selected, line, reduced]);


  useEffect(() => {
    const map = mapRef.current;
    if (ready && map?.getLayer("aera-buildings")) map.setLayoutProperty("aera-buildings", "visibility", is3d && !underground ? "visible" : "none");
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

  // Underground: dim the surface, fade the viaduct and surface trains, bring the tunnel up.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setPaintProperty("aera-ug-dim", "background-opacity", underground ? 0.72 : 0);
    map.setPaintProperty("aera-track", "fill-extrusion-opacity", underground ? 0.22 : 1);
    map.setPaintProperty("aera-platforms", "fill-extrusion-opacity", underground ? 0.3 : 1);
    map.setPaintProperty("aera-track-ug", "fill-extrusion-opacity", underground ? 1 : 0.45);
    map.setPaintProperty("aera-platforms-ug", "fill-extrusion-opacity", underground ? 1 : 0.7);
    layerRef.current?.setUnderground(underground);
    relight.current();
    map.triggerRepaint();
  }, [ready, underground]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={box} className="h-full w-full" role="region" aria-label="3D map of the Kelana Jaya Line with trains coloured by crowding" />
      {hover && (
        <div ref={tip} key={hover.kind} aria-hidden className={`pointer-events-none absolute ${hover.kind === "train" ? "opacity-0 px-3.5 py-2.5" : ""} left-0 top-0 z-10 w-max max-w-[280px] overflow-hidden rounded-2xl bg-white shadow-float`}
          style={hover.kind === "station" ? { transform: `translate(${hover.x}px, ${hover.y}px) translate(-50%, calc(-100% - 14px))` } : undefined}>
          {hover.kind === "train" ? (
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
