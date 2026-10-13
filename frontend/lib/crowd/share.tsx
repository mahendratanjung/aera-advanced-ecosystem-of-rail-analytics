"use client";

/**
 * Opt-in location sharing (YOU-03): while AERA is open and the rider has switched it on, the
 * phone's position goes to /api/crowd/pings every 20 seconds. The service keeps only a
 * distance along the line and counts a train once enough phones ride it (see
 * backend/aera_twin/crowdsource/riders.py). Nothing is sent while the tab is hidden.
 */

import { useEffect } from "react";
import { create } from "zustand";
import { api } from "../api";
import { usePrefs } from "../prefs";
import { deviceId } from "./observed";

const EVERY_MS = 20_000;

export type ShareState = "off" | "waiting" | "sharing" | "denied" | "unavailable" | "error";

interface ShareStatus {
  state: ShareState;
  lastSent: number | null;
  onTrain: string | null;
  set: (s: Partial<Omit<ShareStatus, "set">>) => void;
}

export const useShareStatus = create<ShareStatus>((set) => ({ state: "off", lastSent: null, onTrain: null, set: (s) => set(s) }));

/** Mounted once in the layout. Does nothing until the rider opts in. */
export function LocationSharer() {
  const share = usePrefs((s) => s.share);
  const load = usePrefs((s) => s.load);

  useEffect(() => load(), [load]);

  useEffect(() => {
    const status = useShareStatus.getState().set;
    if (!share) {
      status({ state: "off", onTrain: null });
      return;
    }
    if (!("geolocation" in navigator)) {
      status({ state: "unavailable" });
      return;
    }
    status({ state: "waiting" });
    let lastSent = 0;
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        if (document.hidden || Date.now() - lastSent < EVERY_MS) return;
        lastSent = Date.now();
        api<{ on_train: string | null }>("/crowd/pings", {
          method: "POST",
          json: { device: deviceId(), lat: p.coords.latitude, lon: p.coords.longitude, accuracy_m: Math.min(10_000, p.coords.accuracy) },
        })
          .then((r) => status({ state: "sharing", lastSent: Date.now(), onTrain: r.on_train }))
          .catch(() => status({ state: "error" }));
      },
      (e) => status({ state: e.code === e.PERMISSION_DENIED ? "denied" : "error" }),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [share]);

  return null;
}
