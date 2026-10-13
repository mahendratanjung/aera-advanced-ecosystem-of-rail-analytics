"use client";

/**
 * Rider view or operator view (VIEW-01). Everyone gets the rider view. Signed-in staff get the
 * operator view by default and can switch; the choice is remembered in this browser. The two
 * views have their own tabs and the operator view has navy chrome, so it is always clear which
 * one is on screen.
 */

import { create } from "zustand";
import { useSession } from "./session";

export type View = "rider" | "operator";

const KEY = "aera.view";

interface ViewPref {
  pref: View;
  loaded: boolean;
  set: (v: View) => void;
  load: () => void;
}

export const useViewPref = create<ViewPref>((set) => ({
  pref: "operator",
  loaded: false,
  set: (pref) => {
    try {
      localStorage.setItem(KEY, pref);
    } catch {}
    set({ pref });
  },
  load: () => {
    try {
      const v = localStorage.getItem(KEY);
      if (v === "rider" || v === "operator") return set({ pref: v, loaded: true });
    } catch {}
    set({ loaded: true });
  },
}));

/** The view on screen: operator only for signed-in staff who have not switched to the rider view. */
export function useView(): View {
  const staff = !!useSession((s) => s.user);
  const pref = useViewPref((s) => s.pref);
  return staff && pref === "operator" ? "operator" : "rider";
}
