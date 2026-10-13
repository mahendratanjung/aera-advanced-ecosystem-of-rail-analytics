"use client";

/**
 * Stations the rider picked lately, newest first, kept in this browser only. Search offers
 * them before anything is typed (FIND-01).
 */

const KEY = "aera.recent";
const MAX = 5;

export function recentStations(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberStation(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify([id, ...recentStations().filter((x) => x !== id)].slice(0, MAX)));
  } catch {}
}
