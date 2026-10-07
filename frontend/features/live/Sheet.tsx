"use client";

/**
 * Bottom sheet for phones (MAP-08): rests at peek, half or full height and is dragged by its
 * handle. Reports its height so the map can keep the selection above it. The handle is also
 * a button: tapping it steps through the heights, so the sheet works without dragging.
 */

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

type Snap = "peek" | "half" | "full";

export function Sheet({ children, peek, label, onHeight, resetKey }: {
  children: ReactNode;
  /** Peek height in CSS pixels. */
  peek: number;
  label: string;
  onHeight: (h: number) => void;
  /** Changing this returns the sheet to peek (a new selection). */
  resetKey: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(600);
  const [snap, setSnap] = useState<Snap>("peek");
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ y: number; h: number; moved: boolean } | null>(null);

  // The space the sheet can use is its parent (the map viewport) minus the search bar.
  useLayoutEffect(() => {
    const parent = box.current?.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(() => setRoom(parent.clientHeight - 64));
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  useEffect(() => setSnap("peek"), [resetKey]);

  const heights: Record<Snap, number> = { peek: Math.min(peek, room), half: Math.round(room * 0.56), full: room };
  const h = drag ?? heights[snap];
  const rest = heights[snap];

  useEffect(() => onHeight(rest), [rest, onHeight]);

  const nearest = (x: number): Snap =>
    (Object.entries(heights) as [Snap, number][]).sort((a, b) => Math.abs(a[1] - x) - Math.abs(b[1] - x))[0][0];

  return (
    <section ref={box} aria-label={label}
      className="absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-[24px] bg-white shadow-float"
      style={{ height: h, transition: drag === null ? "height var(--motion-base) var(--ease)" : "none" }}>
      <button type="button"
        aria-label={snap === "full" ? "Shrink panel" : "Expand panel"}
        className="flex h-6 w-full shrink-0 touch-none items-center justify-center"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          start.current = { y: e.clientY, h, moved: false };
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s) return;
          const dy = s.y - e.clientY;
          if (Math.abs(dy) > 4) s.moved = true;
          if (s.moved) setDrag(Math.max(heights.peek * 0.6, Math.min(room, s.h + dy)));
        }}
        onPointerUp={() => {
          const s = start.current;
          start.current = null;
          if (s?.moved && drag !== null) setSnap(nearest(drag));
          else setSnap((v) => (v === "peek" ? "half" : v === "half" ? "full" : "peek"));
          setDrag(null);
        }}
        onPointerCancel={() => {
          start.current = null;
          setDrag(null);
        }}>
        <span aria-hidden className="h-1.5 w-10 rounded-full bg-rule-strong" />
      </button>
      <div className={`min-h-0 flex-1 overscroll-contain px-4 pb-4 ${snap === "peek" && drag === null ? "overflow-hidden" : "overflow-y-auto"}`}>
        {children}
      </div>
    </section>
  );
}
