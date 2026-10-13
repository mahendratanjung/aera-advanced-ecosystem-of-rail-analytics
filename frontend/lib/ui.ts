"use client";

import { create } from "zustand";

/** How far ahead the map can look (MAPC-05). */
export const MAX_AHEAD_MIN = 120;

/** Camera for a selected train: free, kept centred, chasing from behind, or circling it. */
export type Cam = "free" | "follow" | "chase" | "orbit";

interface UiState {
  selectedStation: string | null;
  selectedTrain: string | null;
  followTrain: boolean;
  diving: string | null;
  /** Map view switches, set by the floating controls and read by the map. */
  is3d: boolean;
  underground: boolean;
  liveSky: boolean;
  /** MAPC-01: crowding bands on the track and crowding words on station labels. */
  crowdLayer: boolean;
  /** TRAINS-02: every other Klang Valley line and its trains on the 3D map. */
  otherLines: boolean;
  cam: Cam;
  /** Ask AERA open as the card on the live map (desktop), with an optional first question. */
  asking: boolean;
  askSeed: string | null;
  /** The line as a list, as the card (NET-08). */
  listing: boolean;
  selectStation: (id: string | null) => void;
  selectTrain: (id: string | null) => void;
  setFollow: (v: boolean) => void;
  setDiving: (id: string | null) => void;
  setIs3d: (v: boolean) => void;
  setUnderground: (v: boolean) => void;
  setLiveSky: (v: boolean) => void;
  setCrowdLayer: (v: boolean) => void;
  setOtherLines: (v: boolean) => void;
  setCam: (v: Cam) => void;
  setAsking: (v: boolean, seed?: string | null) => void;
  setListing: (v: boolean) => void;
  /** The keyboard shortcuts panel. */
  keysOpen: boolean;
  setKeysOpen: (v: boolean) => void;
  /** POL-07: the camera touring the line, and the station it is flying to. */
  touring: boolean;
  tourAt: string | null;
  setTouring: (v: boolean) => void;
  setTourAt: (id: string | null) => void;
  /** MAPC-05: minutes ahead of now the map shows (0 = now), and whether its slider is open. */
  ahead: number;
  aheadOpen: boolean;
  setAhead: (min: number) => void;
  setAheadOpen: (v: boolean) => void;
}

/** The map switches a rider sets, kept in this browser between visits. */
type MapView = Pick<UiState, "is3d" | "underground" | "liveSky" | "crowdLayer" | "otherLines">;
const VIEW_KEY = "aera.mapview";
const VIEW_FIELDS = ["is3d", "underground", "liveSky", "crowdLayer", "otherLines"] as const;

function saveView(s: MapView) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(Object.fromEntries(VIEW_FIELDS.map((k) => [k, s[k]]))));
  } catch {}
}

/** The saved switches, once the page is in the browser (the server render keeps the defaults). */
export function restoreMapView() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}") as Partial<Record<keyof MapView, unknown>>;
    const next = Object.fromEntries(VIEW_FIELDS.filter((k) => typeof v[k] === "boolean").map((k) => [k, v[k]]));
    if (Object.keys(next).length) useUi.setState(next);
  } catch {}
}

export const useUi = create<UiState>((set) => ({
  selectedStation: null,
  selectedTrain: null,
  followTrain: false,
  diving: null,
  is3d: true,
  underground: false,
  liveSky: true,
  crowdLayer: true,
  otherLines: true,
  cam: "free",
  asking: false,
  askSeed: null,
  listing: false,
  keysOpen: false,
  touring: false,
  tourAt: null,
  selectStation: (id) => set({ selectedStation: id, selectedTrain: null, followTrain: false, asking: false, listing: false, touring: false, tourAt: null }),
  selectTrain: (id) => set({ selectedTrain: id, selectedStation: null, followTrain: false, cam: id ? "follow" : "free", asking: false, listing: false, touring: false, tourAt: null }),
  setFollow: (v) => set({ followTrain: v }),
  setDiving: (id) => set({ diving: id }),
  setIs3d: (v) => set((s) => ({ is3d: v, cam: !v && (s.cam === "chase" || s.cam === "orbit") ? "follow" : s.cam })),
  setUnderground: (v) => set({ underground: v }),
  setLiveSky: (v) => set({ liveSky: v }),
  setCrowdLayer: (v) => set({ crowdLayer: v }),
  setOtherLines: (v) => set({ otherLines: v }),
  setKeysOpen: (v) => set({ keysOpen: v }),
  // A tour starts from a clear map: no card selection pulling the camera elsewhere.
  setTouring: (v) => set(v ? { touring: true, tourAt: null, selectedStation: null, selectedTrain: null, cam: "free", asking: false, listing: false } : { touring: false, tourAt: null }),
  setTourAt: (id) => set({ tourAt: id }),
  ahead: 0,
  aheadOpen: false,
  setAhead: (min) => set({ ahead: Math.max(0, Math.min(MAX_AHEAD_MIN, Math.round(min))) }),
  setAheadOpen: (v) => set(v ? { aheadOpen: true } : { aheadOpen: false, ahead: 0 }),
  setCam: (v) => set((s) => ({ cam: v, is3d: v === "chase" || v === "orbit" ? true : s.is3d })),
  setAsking: (v, seed = null) => set(v ? { asking: true, askSeed: seed, listing: false, selectedStation: null, selectedTrain: null, followTrain: false } : { asking: false, askSeed: null }),
  setListing: (v) => set(v ? { listing: true, asking: false, selectedStation: null, selectedTrain: null, followTrain: false } : { listing: false }),
}));

// A switch the rider flips is remembered for the next visit.
useUi.subscribe((s, prev) => {
  if (VIEW_FIELDS.some((k) => s[k] !== prev[k])) saveView(s);
});
