"use client";

/**
 * Bottom sheet for phones (MAP-08): rests at peek, half or full height. It can be dragged by
 * its handle or by its content, like a native sheet: below full height any vertical drag
 * moves the sheet; at full height the content scrolls, and pulling down from the top of the
 * content shrinks it. A quick flick goes to the next height. Reports its height so the map
 * can keep the selection above it. The handle is also a button: tapping it steps through the
 * heights, so the sheet works without dragging.
 *
 * Phones (user feedback, 13 Nov 2026): one swipe up from peek carries on into scrolling once
 * the sheet is full, so the bottom of a long card (the station's "Through the day" chart) is a
 * single gesture away; a half height that is barely taller than peek is skipped; a mouse wheel
 * or trackpad scroll opens the sheet fully and then scrolls it; and the content can always be
 * scrolled, so nothing is out of reach.
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

  // The space the sheet can use is its parent (the map viewport) minus the search bar and,
  // on phones with a notch, the status bar above it.
  useLayoutEffect(() => {
    const parent = box.current?.parentElement;
    if (!parent) return;
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;padding-top:env(safe-area-inset-top)";
    document.body.appendChild(probe);
    const safeTop = parseFloat(getComputedStyle(probe).paddingTop) || 0;
    probe.remove();
    const ro = new ResizeObserver(() => setRoom(parent.clientHeight - 64 - safeTop));
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setSnap("peek");
    if (body.current) body.current.scrollTop = 0;
  }, [resetKey]);

  const peekH = Math.min(peek, room);
  // Half sits between peek and full; when there is no real gap it is the same as full.
  const halfH = Math.round(Math.max(room * 0.56, peekH + 140));
  const heights: Record<Snap, number> = { peek: peekH, half: halfH > room - 100 ? room : halfH, full: room };
  const h = drag ?? heights[snap];
  const rest = heights[snap];
  live.current = { snap, heights, room };

  useEffect(() => onHeight(rest), [rest, onHeight]);

  /** Where a drag ends: the next height for a flick, otherwise the nearest one. */
  const settle = (x: number, velocity: number): Snap => {
    const { snap: cur, heights: hs } = live.current;
    const snaps = ORDER.filter((k, j) => j === 0 || hs[k] > hs[ORDER[j - 1]]);
    const i = Math.max(0, snaps.findIndex((k) => hs[k] >= hs[cur]));
    if (velocity > FLICK) return snaps[Math.min(snaps.length - 1, i + 1)];
    if (velocity < -FLICK) return snaps[Math.max(0, i - 1)];
    return snaps.map((k) => [k, hs[k]] as const).sort((a, b) => Math.abs(a[1] - x) - Math.abs(b[1] - x))[0][0];
  };
  const clamp = (x: number) => Math.max(live.current.heights.peek * 0.6, Math.min(live.current.room, x));

  // Dragging by the content needs non-passive touch listeners, so it can stop the page scrolling.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    let s: { y: number; h: number; t: number; mode: "sheet" | "scroll" | null; last: number; lastT: number; top: number } | null = null;
    const down = (e: TouchEvent) => {
      const { snap: cur, heights: hs } = live.current;
      s = { y: e.touches[0].clientY, h: hs[cur], t: e.timeStamp, mode: null, last: e.touches[0].clientY, lastT: e.timeStamp, top: el.scrollTop };
    };
    const move = (e: TouchEvent) => {
      if (!s) return;
      const y = e.touches[0].clientY;
      const dy = s.y - y; // up is positive
      if (s.mode === null) {
        if (Math.abs(dy) < 6) return;
        const full = live.current.heights[live.current.snap] >= live.current.room;
        s.mode = !full || (el.scrollTop <= 0 && dy < 0) ? "sheet" : "scroll";
      }
      if (s.mode === "sheet") {
        e.preventDefault();
        const want = s.h + dy;
        const room = live.current.room;
        // Past full height the same swipe scrolls the content.
        if (want > room) {
          setDrag(room);
          el.scrollTop = s.top + (want - room);
        } else {
          setDrag(clamp(want));
        }
      }
      s.last = y;
      s.lastT = e.timeStamp;
    };
    const up = (e: TouchEvent) => {
      if (s?.mode === "sheet") {
        const y = e.changedTouches[0]?.clientY ?? s.last;
        const dt = Math.max(1, e.timeStamp - s.t);
        const want = s.h + (s.y - y);
        setSnap(want >= live.current.room ? "full" : settle(clamp(want), (s.y - y) / dt));
        setDrag(null);
      }
      s = null;
    };
    // A mouse wheel or trackpad: scrolling down first opens the sheet fully, then scrolls it.
    const wheel = (e: WheelEvent) => {
      const { snap: cur, heights: hs, room } = live.current;
      if (hs[cur] < room && e.deltaY > 0) {
        e.preventDefault();
        setSnap("full");
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", up);
    el.addEventListener("touchcancel", up);
    return () => {
      el.removeEventListener("wheel", wheel);
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
        aria-label={rest >= room ? "Shrink panel" : "Expand panel"}
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
          else setSnap((v) => (v === "full" || heights[v] >= room ? "peek" : v === "peek" && heights.half < room ? "half" : "full"));
          setDrag(null);
        }}
        onPointerCancel={() => {
          start.current = null;
          setDrag(null);
        }}>
        <span aria-hidden className="h-1.5 w-10 rounded-full bg-rule-strong" />
      </button>
      <div ref={body} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
        {children}
      </div>
    </section>
  );
}
