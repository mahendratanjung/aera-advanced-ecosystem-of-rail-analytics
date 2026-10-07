"use client";

/** The rider's usual station (CARD-01), kept in this browser only. */

import { create } from "zustand";

const KEY = "aera.home";
const DEFAULT = "KJ20";

interface HomeState {
  id: string;
  load: (valid: string[]) => void;
  set: (id: string) => void;
}

export const useHome = create<HomeState>((set) => ({
  id: DEFAULT,
  load: (valid) => {
    try {
      const v = localStorage.getItem(KEY);
      if (v && valid.includes(v)) set({ id: v });
    } catch {}
  },
  set: (id) => {
    set({ id });
    try {
      localStorage.setItem(KEY, id);
    } catch {}
  },
}));
