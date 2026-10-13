"use client";

/**
 * Keyboard shortcuts for the live map, in the manner of Mini Tokyo 3D and most map sites, and
 * the panel that lists them ("?"). One list drives the keys, the panel and the button tooltips.
 */

import { X } from "@phosphor-icons/react/dist/ssr";
import { useEffect } from "react";
import { useUi } from "@/lib/ui";
import { mapApi } from "./GeoMap";
import { FLOAT } from "./MapChrome";

export type ShortcutId =
  | "search" | "zoomIn" | "zoomOut" | "north" | "whole" | "tour" | "3d" | "underground" | "sky" | "crowd" | "ahead" | "lines" | "key" | "list" | "fullscreen" | "close" | "help";

/** Key shown to the rider, the keys that trigger it, and what it does. */
export const SHORTCUTS: { id: ShortcutId; show: string; keys: string[]; label: string }[] = [
  { id: "search", show: "/", keys: ["/"], label: "Search stations" },
  { id: "zoomIn", show: "+", keys: ["+", "="], label: "Zoom in" },
  { id: "zoomOut", show: "−", keys: ["-", "_"], label: "Zoom out" },
  { id: "north", show: "N", keys: ["n"], label: "Point north" },
  { id: "whole", show: "W", keys: ["w"], label: "Show the whole line" },
  { id: "tour", show: "T", keys: ["t"], label: "Tour the line" },
  { id: "3d", show: "3", keys: ["3"], label: "3D or flat map" },
  { id: "underground", show: "U", keys: ["u"], label: "Underground view" },
  { id: "sky", show: "S", keys: ["s"], label: "Lighting follows the clock" },
  { id: "crowd", show: "C", keys: ["c"], label: "Crowding on the track" },
  { id: "ahead", show: "A", keys: ["a"], label: "Crowding ahead (next 2 hours)" },
  { id: "lines", show: "O", keys: ["o"], label: "Other lines and their trains" },
  { id: "key", show: "K", keys: ["k"], label: "Crowding key" },
  { id: "list", show: "L", keys: ["l"], label: "Line as a list" },
  { id: "fullscreen", show: "F", keys: ["f"], label: "Full screen" },
  { id: "close", show: "Esc", keys: [], label: "Close the card" },
  { id: "help", show: "?", keys: ["?"], label: "These shortcuts" },
];

export const shortcutKey = (id: ShortcutId) => SHORTCUTS.find((s) => s.id === id)?.show ?? "";

export function canFullscreen(): boolean {
  return typeof document !== "undefined" && !!document.documentElement.requestFullscreen;
}

export function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}

function typing(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

/** Listens for the shortcuts while the live map is open. "/" and Esc are handled where they act. */
export function useMapShortcuts(onKey: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const hit = SHORTCUTS.find((s) => s.keys.includes(e.key.length === 1 ? e.key.toLowerCase() : e.key) || s.keys.includes(e.key));
      if (!hit || hit.id === "search" || hit.id === "close") return;
      // The map zooms with + and - itself when it has focus.
      const onMap = !!(e.target as HTMLElement | null)?.closest?.(".maplibregl-map, .mapboxgl-map");
      if (onMap && (hit.id === "zoomIn" || hit.id === "zoomOut")) return;
      e.preventDefault();
      const ui = useUi.getState();
      switch (hit.id) {
        case "zoomIn": return mapApi.current?.zoomBy(1);
        case "zoomOut": return mapApi.current?.zoomBy(-1);
        case "north": return mapApi.current?.resetNorth();
        case "whole": return mapApi.current?.wholeLine();
        case "tour": return ui.setTouring(!ui.touring);
        case "3d": return ui.setIs3d(!ui.is3d);
        case "underground": return ui.setUnderground(!ui.underground);
        case "sky": return ui.setLiveSky(!ui.liveSky);
        case "crowd": return ui.setCrowdLayer(!ui.crowdLayer);
        case "lines": return ui.setOtherLines(!ui.otherLines);
        case "ahead": return ui.setAheadOpen(!ui.aheadOpen);
        case "key": return onKey();
        case "list": return ui.setListing(!ui.listing);
        case "fullscreen": return toggleFullscreen();
        case "help": return ui.setKeysOpen(!ui.keysOpen);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onKey]);
}

export function Kbd({ children, dark = false }: { children: string; dark?: boolean }) {
  return (
    <kbd className={`num inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 text-[11px] font-bold ${dark ? "bg-white/15 text-white" : "border border-rule bg-surface-2 text-ink-2"}`}>
      {children}
    </kbd>
  );
}

export function ShortcutsPanel() {
  const open = useUi((s) => s.keysOpen);
  const setOpen = useUi((s) => s.setKeysOpen);
  if (!open) return null;
  return (
    <section role="dialog" aria-label="Keyboard shortcuts" className={`enter w-72 rounded-[20px] p-4 ${FLOAT}`}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[14px] font-extrabold text-ink">Keyboard shortcuts</h2>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close keyboard shortcuts" className="flex h-7 w-7 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2">
          <X size={14} weight="bold" aria-hidden />
        </button>
      </div>
      <ul className="grid gap-1.5">
        {SHORTCUTS.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 text-[13px] text-ink-2">
            <span>{s.label}</span><Kbd>{s.show}</Kbd>
          </li>
        ))}
      </ul>
    </section>
  );
}
