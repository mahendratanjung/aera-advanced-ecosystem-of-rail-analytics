"use client";

import { create } from "zustand";
import type { User } from "./types";

const KEY = "aera.session";

interface Session {
  token: string | null;
  user: User | null;
  ready: boolean;
  signIn: (token: string, user: User) => void;
  signOut: () => void;
  hydrate: () => void;
}

export const useSession = create<Session>((set) => ({
  token: null,
  user: null,
  ready: false,
  signIn: (token, user) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ token, user }));
    } catch {}
    set({ token, user, ready: true });
  },
  signOut: () => {
    try {
      localStorage.removeItem(KEY);
    } catch {}
    set({ token: null, user: null, ready: true });
  },
  hydrate: () => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const { token, user } = JSON.parse(raw);
        set({ token, user, ready: true });
        return;
      }
    } catch {}
    set({ ready: true });
  },
}));
