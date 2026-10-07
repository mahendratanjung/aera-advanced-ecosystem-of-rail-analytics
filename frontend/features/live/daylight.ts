/**
 * Map colours through the day. Day, dusk and night palettes come from theme.css and are
 * blended by how far the sun is below the horizon, so the map fades into evening as the
 * sim clock runs, the way Mini Tokyo 3D does.
 */

import type { Map as MlMap } from "maplibre-gl";
import { token } from "@/lib/theme";

const KEYS = ["land", "water", "road", "label", "building", "viaduct", "station", "sky", "horizon", "fog", "ink", "halo"] as const;
export type PaletteKey = (typeof KEYS)[number];
export type Palette = Record<PaletteKey, string>;

const DAY: Record<PaletteKey, string> = {
  land: "--map-land", water: "--map-water", road: "--map-road", label: "--map-label", building: "--map-building",
  viaduct: "--map-viaduct", station: "--map-station", sky: "--map-sky", horizon: "--map-horizon", fog: "--map-fog",
  ink: "--ink", halo: "--surface",
};
const DUSK: Partial<Record<PaletteKey, string>> = { sky: "--map-sky-dusk", horizon: "--map-horizon-dusk", fog: "--map-fog-dusk" };

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const x = rgb(a);
  const y = rgb(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

export class Palettes {
  private readonly day: Palette;
  private readonly night: Palette;
  private readonly dusk: Partial<Palette>;

  constructor() {
    const read = (m: Partial<Record<PaletteKey, string>>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, token(v!)]));
    this.day = read(DAY) as Palette;
    this.night = read(Object.fromEntries(KEYS.map((k) => [k, `--map-${k}-night`]))) as Palette;
    this.dusk = read(DUSK);
  }

  at(night: number, dusk: number): Palette {
    const out = {} as Palette;
    for (const k of KEYS) {
      const base = mix(this.day[k], this.night[k], night);
      const warm = this.dusk[k];
      out[k] = warm ? mix(base, warm, dusk * 0.85) : base;
    }
    return out;
  }
}

/** A basemap paint property and the palette colour it takes. */
export interface BasemapTarget {
  id: string;
  prop: string;
  key: PaletteKey;
}

/**
 * Quietens the Carto basemap (no POIs, road labels, transit lines or flat buildings) and
 * returns the paint properties that follow the palette.
 */
export function quietBasemap(map: MlMap): BasemapTarget[] {
  const out: BasemapTarget[] = [];
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.id.startsWith("aera-")) continue;
    try {
      if (layer.type === "background") out.push({ id: layer.id, prop: "background-color", key: "land" });
      else if (layer.type === "fill") {
        if (/water/.test(layer.id)) out.push({ id: layer.id, prop: "fill-color", key: "water" });
        else if (/building/.test(layer.id)) map.setLayoutProperty(layer.id, "visibility", "none");
        else out.push({ id: layer.id, prop: "fill-color", key: "land" });
      } else if (layer.type === "line") {
        if (/water|river/.test(layer.id)) out.push({ id: layer.id, prop: "line-color", key: "water" });
        else if (/rail|transit/.test(layer.id)) map.setLayoutProperty(layer.id, "visibility", "none");
        else out.push({ id: layer.id, prop: "line-color", key: "road" });
      } else if (layer.type === "symbol") {
        if (/poi|housenum|road|highway|shield|transit|rail/.test(layer.id)) map.setLayoutProperty(layer.id, "visibility", "none");
        else {
          out.push({ id: layer.id, prop: "text-color", key: "label" });
          out.push({ id: layer.id, prop: "text-halo-color", key: "halo" });
        }
      }
    } catch {
      /* layers with expressions are left alone */
    }
  }
  return out;
}

export function paintBasemap(map: MlMap, targets: BasemapTarget[], p: Palette) {
  for (const t of targets) {
    try {
      (map.setPaintProperty as (id: string, prop: string, value: unknown) => void).call(map, t.id, t.prop, p[t.key]);
    } catch {
      /* a layer the style no longer has */
    }
  }
}
