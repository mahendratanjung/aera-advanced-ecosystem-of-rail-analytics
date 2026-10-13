"use client";

/**
 * What a rider chooses, kept in this browser only (riders have no account): whether they have
 * seen the welcome (ONB-01), the rides they saved (YOU-02) and whether they share their
 * location to help count crowding (YOU-03, LIVE_DATA "location sharing"). Off by default.
 */

import { create } from "zustand";

const KEY = "aera.prefs";

export interface SavedRide {
  from: string;
  to: string;
}

interface Stored {
  welcomed: boolean;
  rides: SavedRide[];
  share: boolean;
}

interface Prefs extends Stored {
  loaded: boolean;
  load: () => void;
  setWelcomed: (v: boolean) => void;
  toggleRide: (r: SavedRide) => void;
  setShare: (v: boolean) => void;
  reset: () => void;
}

const EMPTY: Stored = { welcomed: false, rides: [], share: false };
const MAX_RIDES = 8;

function save(s: Stored) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ welcomed: s.welcomed, rides: s.rides, share: s.share }));
  } catch {}
}

export const sameRide = (a: SavedRide, b: SavedRide) => a.from === b.from && a.to === b.to;

export const usePrefs = create<Prefs>((set, get) => ({
  ...EMPTY,
  loaded: false,
  load: () => {
    if (get().loaded) return;
    try {
      const raw = localStorage.getItem(KEY);
      const v = raw ? (JSON.parse(raw) as Partial<Stored>) : {};
      set({
        loaded: true,
        welcomed: !!v.welcomed,
        share: !!v.share,
        rides: Array.isArray(v.rides) ? v.rides.filter((r) => r && typeof r.from === "string" && typeof r.to === "string").slice(0, MAX_RIDES) : [],
      });
    } catch {
      set({ loaded: true });
    }
  },
  setWelcomed: (welcomed) => {
    set({ welcomed });
    save(get());
  },
  toggleRide: (r) => {
    const rides = get().rides.some((x) => sameRide(x, r)) ? get().rides.filter((x) => !sameRide(x, r)) : [r, ...get().rides].slice(0, MAX_RIDES);
    set({ rides });
    save(get());
  },
  setShare: (share) => {
    set({ share });
    save(get());
  },
  reset: () => {
    set({ ...EMPTY });
    try {
      localStorage.removeItem(KEY);
    } catch {}
  },
}));
