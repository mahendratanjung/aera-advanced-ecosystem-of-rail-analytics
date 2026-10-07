"use client";

/**
 * Network twin (NET-01 to NET-07). A MapLibre map with the line in its official colour,
 * station lanterns coloured by congestion and trains computed in the browser from the
 * timetable every frame (section 11.3.1).
 *
 * The map stays mounted across "/" and "/station/[id]" so entering a station is one
 * continuous camera move that ends with the map dimmed behind the 3D scene (UX-04).
 */

import type { GeoJSONSource, Map as MlMap, StyleSpecification } from "maplibre-gl";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EmptyState } from "@/components/States";
import { useLine } from "@/lib/hooks";
import { lineBounds, pointAt } from "@/lib/sim/geo";
import { simNowMs } from "@/lib/sim/clock";
import type { TrainState } from "@/lib/sim/trains";
import { useTwin } from "@/lib/store";
import { motion, prefersReducedMotion, token } from "@/lib/theme";
import { useUi } from "@/lib/ui";
import type { LineData } from "@/lib/types";
import { SkyTint } from "./SkyTint";
import { StationMarker } from "./StationMarker";

const BASEMAP = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const DATA_CREDIT = "Timetable © Prasarana, GTFS Static via data.gov.my";

/** Shared with panels that describe the selected train. Updated every frame. */
export const liveTrains: { list: TrainState[] } = { list: [] };

/** Keep the line clear of the nav rail and the context panel (section 10.5). */
function linePadding() {
  if (typeof window === "undefined") return 60;
  const { innerWidth: w, innerHeight: h } = window;
  return w >= 768 ? { top: 60, bottom: 60, left: 110, right: 440 } : { top: 70, bottom: Math.round(h * 0.3) + 20, left: 24, right: 24 };
}

function fallbackStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: "background", type: "background", paint: { "background-color": token("--map-bg") } }],
  };
}

function recolourBasemap(map: MlMap) {
  const bg = token("--map-bg");
  const water = token("--map-water");
  const land = token("--map-land");
  const road = token("--map-road");
  const label = token("--map-label");
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.id.startsWith("aera-")) continue;
    try {
      if (layer.type === "background") map.setPaintProperty(layer.id, "background-color", bg);
      else if (layer.type === "fill") map.setPaintProperty(layer.id, "fill-color", /water/.test(layer.id) ? water : land);
      else if (layer.type === "line") {
        if (/water|river|stream/.test(layer.id)) map.setPaintProperty(layer.id, "line-color", water);
        else map.setPaintProperty(layer.id, "line-color", road);
      } else if (layer.type === "symbol") {
        if (/poi|housenum|road|highway|shield/.test(layer.id)) map.setLayoutProperty(layer.id, "visibility", "none");
        else {
          map.setPaintProperty(layer.id, "text-color", label);
          map.setPaintProperty(layer.id, "text-halo-color", bg);
        }
      }
    } catch {
      /* some layers use expressions we leave alone */
    }
  }
}

function addLineLayers(map: MlMap, line: LineData) {
  const colour = line.color ?? token("--brand-cyan"); // NET-02: always from route_color when present
  if (!map.getSource("aera-line")) {
    map.addSource("aera-line", {
      type: "geojson",
      data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line.shape } },
    });
    map.addSource("aera-suspended", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addSource("aera-trains", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }
  const add = (spec: Parameters<MlMap["addLayer"]>[0]) => !map.getLayer(spec.id) && map.addLayer(spec);
  add({ id: "aera-line-glow", type: "line", source: "aera-line", layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": colour, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 8, 16, 22], "line-blur": 8, "line-opacity": 0.35 } });
  add({ id: "aera-line-core", type: "line", source: "aera-line", layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": colour, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.2, 16, 6] } });
  add({ id: "aera-suspended", type: "line", source: "aera-suspended", layout: { "line-cap": "butt" },
    paint: { "line-color": token("--lvl-crowded"), "line-width": ["interpolate", ["linear"], ["zoom"], 10, 4, 16, 10], "line-dasharray": [1.2, 1.2] } });
  add({ id: "aera-trains-halo", type: "circle", source: "aera-trains",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 7, 16, 18],
      "circle-color": ["case", ["==", ["get", "status"], "held"], token("--lvl-busy"), colour],
      "circle-blur": 0.9, "circle-opacity": 0.6,
    } });
  add({ id: "aera-trains-core", type: "circle", source: "aera-trains",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 16, 7],
      "circle-color": token("--text-strong"),
      "circle-stroke-color": ["case", ["==", ["get", "status"], "held"], token("--lvl-busy"), colour],
      "circle-stroke-width": 1.5,
    } });
  add({ id: "aera-trains-selected", type: "circle", source: "aera-trains", filter: ["==", ["get", "trip"], ""],
    paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 11, 16, 22], "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": token("--brand-cyan"), "circle-stroke-width": 2 } });
}

function suspendedSections(line: LineData, disruptions: { kind: string; stop_id: string; to_stop_id: string | null }[]) {
  const dist = Object.fromEntries(line.stations.map((s) => [s.id, s.distance_m]));
  return {
    type: "FeatureCollection" as const,
    features: disruptions
      .filter((d) => d.kind === "suspend" && d.to_stop_id && d.stop_id in dist && d.to_stop_id in dist)
      .map((d) => {
        const a = Math.min(dist[d.stop_id], dist[d.to_stop_id!]);
        const b = Math.max(dist[d.stop_id], dist[d.to_stop_id!]);
        const coords = [pointAt(line, a), ...line.shape_distances.map((x, i) => [x, i] as const).filter(([x]) => x > a && x < b)
          .map(([, i]) => ({ lon: line.shape[i][0], lat: line.shape[i][1] })), pointAt(line, b)].map((p) => [p.lon, p.lat]);
        return { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: coords } };
      }),
  };
}

export function NetworkMap() {
  const { line, model, error } = useLine("KJ");
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [markers, setMarkers] = useState<Record<string, HTMLElement>>({});
  const [zoom, setZoom] = useState(11);
  const [ready, setReady] = useState(false);
  const path = usePathname();
  const router = useRouter();
  const focused = path.match(/^\/station\/([^/]+)/)?.[1] ?? null;
  const disruptions = useTwin((s) => s.sim?.disruptions);
  const selectedTrain = useUi((s) => s.selectedTrain);

  // Create the map once the line has loaded.
  useEffect(() => {
    if (!line || !container.current || mapRef.current) return;
    let cancelled = false;
    let raf = 0;
    (async () => {
      const maplibregl = await import("maplibre-gl");
      maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      if (cancelled || !container.current) return;
      const bounds = lineBounds(line);
      const map = new maplibregl.Map({
        container: container.current,
        style: BASEMAP,
        bounds,
        fitBoundsOptions: { padding: linePadding() },
        pitch: 35,
        bearing: -12,
        maxPitch: 75,
        attributionControl: { compact: true, customAttribution: DATA_CREDIT },
        cooperativeGestures: false,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
      let fellBack = false;
      map.on("error", (e) => {
        const err = e.error as (Error & { url?: string }) | undefined;
        const styleFailed = String(err?.url ?? err?.message ?? "").includes("style.json");
        if (!fellBack && styleFailed) {
          fellBack = true;
          map.setStyle(fallbackStyle());
        }
      });
      map.on("style.load", () => {
        recolourBasemap(map);
        addLineLayers(map, line);
        setReady(true);
      });
      map.on("zoomend", () => setZoom(map.getZoom()));
      map.on("click", "aera-trains-core", (e) => {
        const trip = e.features?.[0]?.properties?.trip as string | undefined;
        if (trip) useUi.getState().selectTrain(trip);
      });
      map.on("click", (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: ["aera-trains-core", "aera-trains-halo"] });
        if (!hits.length && !(e.originalEvent.target as HTMLElement).closest("[data-station-marker]")) {
          useUi.getState().selectStation(null);
        }
      });
      map.on("mouseenter", "aera-trains-core", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "aera-trains-core", () => (map.getCanvas().style.cursor = ""));

      // Station lanterns are DOM markers so they are focusable buttons (UX-06).
      const els: Record<string, HTMLElement> = {};
      for (const s of line.stations) {
        const el = document.createElement("div");
        el.dataset.stationMarker = s.id;
        new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([s.lon, s.lat]).addTo(map);
        els[s.id] = el;
      }
      setMarkers(els);

      // Trains every frame (30 fps on small screens to protect the battery, NFR-02).
      const small = window.matchMedia("(max-width: 768px)").matches;
      const minGap = small ? 33 : 0;
      let last = 0;
      const frame = (ts: number) => {
        raf = requestAnimationFrame(frame);
        if (ts - last < minGap || !model) return;
        last = ts;
        const src = map.getSource("aera-trains") as GeoJSONSource | undefined;
        if (!src) return;
        const st = useTwin.getState();
        const t = simNowMs(st.sim?.clock, st.offsetMs) / 1000;
        const trains = model.activeTrains(t, st.sim?.disruptions ?? []);
        liveTrains.list = trains;
        src.setData({
          type: "FeatureCollection",
          features: trains.map((tr) => {
            const p = pointAt(line, tr.distanceM);
            return { type: "Feature", properties: { trip: tr.tripId, status: tr.status, dir: tr.directionId },
              geometry: { type: "Point", coordinates: [p.lon, p.lat] } };
          }),
        });
        const ui = useUi.getState();
        if (ui.followTrain && ui.selectedTrain) {
          const tr = trains.find((x) => x.tripId === ui.selectedTrain);
          if (tr) {
            const p = pointAt(line, tr.distanceM);
            map.jumpTo({ center: [p.lon, p.lat] });
          }
        }
      };
      raf = requestAnimationFrame(frame);
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [line, model]);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
    },
    [],
  );

  // Suspended sections drawn as dashed red.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !line) return;
    (map.getSource("aera-suspended") as GeoJSONSource | undefined)?.setData(suspendedSections(line, disruptions ?? []));
  }, [ready, line, disruptions]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setFilter("aera-trains-selected", ["==", ["get", "trip"], selectedTrain ?? ""]);
  }, [ready, selectedTrain]);

  // The dive into a station, and back out to the whole line (UX-04).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !line) return;
    const duration = prefersReducedMotion() ? 0 : motion.dive();
    const interactive = !focused;
    for (const h of [map.dragPan, map.scrollZoom, map.boxZoom, map.dragRotate, map.keyboard, map.doubleClickZoom, map.touchZoomRotate]) {
      if (interactive) h.enable();
      else h.disable();
    }
    if (focused) {
      const s = line.stations.find((x) => x.id === focused);
      if (!s) return;
      const p = pointAt(line, s.distance_m + 1);
      map.flyTo({ center: [s.lon, s.lat], zoom: 17.2, pitch: 68, bearing: p.bearing - 90, duration, essential: true });
    } else {
      map.fitBounds(lineBounds(line), { padding: linePadding(), pitch: 35, bearing: -12, duration });
    }
    useUi.getState().setDiving(null);
  }, [ready, focused, line]);

  const enter = (id: string) => {
    useUi.getState().setDiving(id);
    router.push(`/station/${id}`);
  };

  if (error) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-deep p-6">
        <EmptyState title="The line could not be loaded" body={`The twin service did not respond (${error}). Check that it is running and refresh.`} />
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 bg-deep"
      style={{ opacity: focused ? 0.32 : 1, filter: focused ? "saturate(0.6)" : "none", transition: `opacity var(--motion-dive) var(--ease-inout), filter var(--motion-dive)` }}
      aria-hidden={focused ? true : undefined}
    >
      <div ref={container} className="h-full w-full" role="region" aria-label="Map of the Kelana Jaya Line with live trains" />
      <SkyTint />
      {!line && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="eyebrow pulse-slow">Loading the line…</p>
        </div>
      )}
      {line &&
        Object.entries(markers).map(([id, el]) => {
          const s = line.stations.find((x) => x.id === id)!;
          return createPortal(
            <StationMarker
              station={s}
              twin={line.twin_stations.includes(id)}
              showLabel={zoom >= 12.2 || line.twin_stations.includes(id)}
              onEnter={enter}
              hidden={!!focused}
            />,
            el,
            id,
          );
        })}
    </div>
  );
}
