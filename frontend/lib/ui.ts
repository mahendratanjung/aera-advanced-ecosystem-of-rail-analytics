"use client";

import { create } from "zustand";

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
  cam: Cam;
  selectStation: (id: string | null) => void;
  selectTrain: (id: string | null) => void;
  setFollow: (v: boolean) => void;
  setDiving: (id: string | null) => void;
  setIs3d: (v: boolean) => void;
  setUnderground: (v: boolean) => void;
  setLiveSky: (v: boolean) => void;
  setCam: (v: Cam) => void;
}

export const useUi = create<UiState>((set) => ({
  selectedStation: null,
  selectedTrain: null,
  followTrain: false,
  diving: null,
  is3d: true,
  underground: false,
  liveSky: true,
  cam: "free",
  selectStation: (id) => set({ selectedStation: id, selectedTrain: null, followTrain: false }),
  selectTrain: (id) => set({ selectedTrain: id, selectedStation: null, followTrain: false, cam: id ? "follow" : "free" }),
  setFollow: (v) => set({ followTrain: v }),
  setDiving: (id) => set({ diving: id }),
  setIs3d: (v) => set((s) => ({ is3d: v, cam: !v && (s.cam === "chase" || s.cam === "orbit") ? "follow" : s.cam })),
  setUnderground: (v) => set({ underground: v }),
  setLiveSky: (v) => set({ liveSky: v }),
  setCam: (v) => set((s) => ({ cam: v, is3d: v === "chase" || v === "orbit" ? true : s.is3d })),
}));
