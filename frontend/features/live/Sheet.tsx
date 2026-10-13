"use client";

/**
 * Bottom sheet for phones (MAP-08): rests at peek, half or full height. It can be dragged by
 * its handle or by its content, like a native sheet: below full height any vertical drag
 * moves the sheet; at full height the content scrolls, and pulling down from the top of the
 * content shrinks it. A quick flick goes to the next height. Reports its height so the map
 * can keep the selection above it. The handle is also a button: tapping it steps through the
 * heights, so the sheet works without dragging.
 */

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

type Snap = "peek" | "half" | "full";
const ORDER: Snap[] = ["peek", "half", "full"];
const FLICK = 0.45; // px per ms

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
  const body = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(600);
  const [snap, setSnap] = useState<Snap>("peek");
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ y: number; h: number; moved: boolean; t: number } | null>(null);
  const live = useRef({ snap, heights: { peek, half: 0, full: 0 } as Record<Snap, number>, room });

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
  live.current = { snap, heights, room };

  useEffect(() => onHeight(rest), [rest, onHeight]);

  /** Where a drag ends: the next height for a flick, otherwise the nearest one. */
  const settle = (x: number, velocity: number): Snap => {
    const { snap: cur, heights: hs } = live.current;
    const i = ORDER.indexOf(cur);
    if (velocity > FLICK) return ORDER[Math.min(2, i + 1)];
    if (velocity < -FLICK) return ORDER[Math.max(0, i - 1)];
    return (Object.entries(hs) as [Snap, number][]).sort((a, b) => Math.abs(a[1] - x) - Math.abs(b[1] - x))[0][0];
  };
  const clamp = (x: number) => Math.max(live.current.heights.peek * 0.6, Math.min(live.current.room, x));

  // Dragging by the content needs non-passive touch listeners, so it can stop the page scrolling.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    let s: { y: number; h: number; t: number; mode: "sheet" | "scroll" | null; last: number; lastT: number } | null = null;
    const down = (e: TouchEvent) => {
      const { snap: cur, heights: hs } = live.current;
      s = { y: e.touches[0].clientY, h: hs[cur], t: e.timeStamp, mode: null, last: e.touches[0].clientY, lastT: e.timeStamp };
    };
    const move = (e: TouchEvent) => {
      if (!s) return;
      const y = e.touches[0].clientY;
      const dy = s.y - y; // up is positive
      if (s.mode === null) {
        if (Math.abs(dy) < 6) return;
        const full = live.current.snap === "full";
        s.mode = !full || (el.scrollTop <= 0 && dy < 0) ? "sheet" : "scroll";
      }
      if (s.mode === "sheet") {
        e.preventDefault();
        setDrag(clamp(s.h + dy));
      }
      s.last = y;
      s.lastT = e.timeStamp;
    };
    const up = (e: TouchEvent) => {
      if (s?.mode === "sheet") {
        const y = e.changedTouches[0]?.clientY ?? s.last;
        const dt = Math.max(1, e.timeStamp - s.t);
        setSnap(settle(clamp(s.h + (s.y - y)), (s.y - y) / dt));
        setDrag(null);
      }
      s = null;
    };
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", up);
    el.addEventListener("touchcancel", up);
    return () => {
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", up);
      el.removeEventListener("touchcancel", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section ref={box} aria-label={label}
      className="absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-[24px] bg-white shadow-float"
      style={{ height: h, transition: drag === null ? "height var(--motion-base) var(--ease)" : "none" }}>
      <button type="button"
        aria-label={snap === "full" ? "Shrink panel" : "Expand panel"}
        className="flex h-7 w-full shrink-0 touch-none items-center justify-center"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          start.current = { y: e.clientY, h, moved: false, t: e.timeStamp };
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s) return;
          const dy = s.y - e.clientY;
          if (Math.abs(dy) > 4) s.moved = true;
          if (s.moved) setDrag(clamp(s.h + dy));
        }}
        onPointerUp={(e) => {
          const s = start.current;
          start.current = null;
          if (s?.moved && drag !== null) setSnap(settle(drag, (s.y - e.clientY) / Math.max(1, e.timeStamp - s.t)));
          else setSnap((v) => (v === "peek" ? "half" : v === "half" ? "full" : "peek"));
          setDrag(null);
        }}
        onPointerCancel={() => {
          start.current = null;
          setDrag(null);
        }}>
        <span aria-hidden className="h-1.5 w-10 rounded-full bg-rule-strong" />
      </button>
      <div ref={body} className={`min-h-0 flex-1 overscroll-contain px-4 pb-4 ${snap === "full" && drag === null ? "overflow-y-auto" : "overflow-hidden"}`}>
        {children}
      </div>
    </section>
  );
}
