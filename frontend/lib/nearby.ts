"use client";

/**
 * Where the rider is, for the live page's "near you" (LIVE-01). The position never leaves the
 * phone: it only picks the nearest station. Asked for once on the first visit to Live; after
 * that only used when the browser already allows it. Without it, My station stands in.
 */

import { create } from "zustand";

export type LocState = "idle" | "locating" | "found" | "denied" | "unavailable";

export interface Position {
  lat: number;
  lon: number;
  accuracy: number;
  at: number;
}

const ASKED = "aera.locAsked";

interface Nearby {
  state: LocState;
  pos: Position | null;
  /** Ask the browser for a position. `prompt` false only uses it when permission was already given. */
  locate: (prompt: boolean) => Promise<void>;
}

async function permission(): Promise<PermissionState | "unknown"> {
  try {
    const p = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    return p?.state ?? "unknown";
  } catch {
    return "unknown";
  }
}

export const useNearby = create<Nearby>((set, get) => ({
  state: "idle",
  pos: null,
  locate: async (prompt) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return set({ state: "unavailable" });
    if (get().state === "locating") return;
    const perm = await permission();
    if (perm === "denied") return set({ state: "denied" });
    if (perm !== "granted" && !prompt) return;
    try {
      localStorage.setItem(ASKED, "1");
    } catch {}
    set({ state: "locating" });
    navigator.geolocation.getCurrentPosition(
      (p) => set({ state: "found", pos: { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() } }),
      (e) => set({ state: e.code === e.PERMISSION_DENIED ? "denied" : "unavailable" }),
      { enableHighAccuracy: false, maximumAge: 120_000, timeout: 12_000 },
    );
  },
}));

/** True until the rider has been asked once (the first visit to Live asks). */
export function neverAsked(): boolean {
  try {
    return !localStorage.getItem(ASKED);
  } catch {
    return false;
  }
}

export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r;
  const dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Within this distance of a station the rider is "near" it; further away My station is used. */
export const NEAR_KM = 4;

export function nearestStation<S extends { id: string; lat: number; lon: number }>(stations: S[], pos: { lat: number; lon: number }): { station: S; km: number } | null {
  let best: { station: S; km: number } | null = null;
  for (const s of stations) {
    const km = distanceKm(pos.lat, pos.lon, s.lat, s.lon);
    if (!best || km < best.km) best = { station: s, km };
  }
  return best;
}

export function distanceText(km: number): string {
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}
