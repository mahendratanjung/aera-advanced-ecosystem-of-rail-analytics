"use client";

import { create } from "zustand";
import type { User } from "./types";

const KEY = "aera.session";

interface Session {
  token: string | null;
  user: User | null;
  ready: boolean;
  /** LOGIN-01: "Keep me signed in" keeps the session in this browser; otherwise it ends with the tab. */
  signIn: (token: string, user: User, remember?: boolean) => void;
  signOut: () => void;
  hydrate: () => void;
}

function clearStored() {
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {}
}

function expired(token: unknown): boolean {
  try {
    const part = typeof token === "string" ? token.split(".")[1] : "";
    const exp = part ? JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))).exp : null;
    return typeof exp === "number" && exp * 1000 < Date.now();
  } catch {
    return false;
  }
}

export const useSession = create<Session>((set) => ({
  token: null,
  user: null,
  ready: false,
  signIn: (token, user, remember = true) => {
    clearStored();
    try {
      (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify({ token, user }));
    } catch {}
    set({ token, user, ready: true });
  },
  signOut: () => {
    clearStored();
    set({ token: null, user: null, ready: true });
  },
  hydrate: () => {
    try {
      const raw = localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
      if (raw) {
        const { token, user } = JSON.parse(raw);
        // A token past its expiry is dropped rather than failing on the first staff call.
        if (expired(token)) {
          clearStored();
        } else {
          set({ token, user, ready: true });
          return;
        }
      }
    } catch {}
    set({ ready: true });
  },
}));
