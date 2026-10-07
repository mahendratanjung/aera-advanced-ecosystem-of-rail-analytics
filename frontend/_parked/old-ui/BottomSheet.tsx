"use client";

import { useRef, useState } from "react";

type Snap = "peek" | "half" | "full";
const HEIGHT: Record<Snap, string> = { peek: "28dvh", half: "55dvh", full: "88dvh" };

/** Phone context panel that drags between peek, half and full height (section 10.5). */
export function BottomSheet({ children, label, initial = "peek" }: { children: React.ReactNode; label: string; initial?: Snap }) {
  const [snap, setSnap] = useState<Snap>(initial);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ y: number; h: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const onDown = (e: React.PointerEvent) => {
    start.current = { y: e.clientY, h: ref.current?.getBoundingClientRect().height ?? 0 };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    setDrag(Math.max(80, start.current.h + (start.current.y - e.clientY)));
  };
  const onUp = () => {
    if (!start.current) return;
    const h = drag ?? start.current.h;
    const vh = window.innerHeight;
    setSnap(h > vh * 0.72 ? "full" : h > vh * 0.4 ? "half" : "peek");
    setDrag(null);
    start.current = null;
  };
  const cycle = () => setSnap((s) => (s === "peek" ? "half" : s === "half" ? "full" : "peek"));

  return (
    <section
      ref={ref}
      aria-label={label}
      className="theme-auto fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl border-t border-subtle bg-panel shadow-[0_-12px_40px_rgba(0,0,0,0.35)]"
      style={{ height: drag ?? HEIGHT[snap], transition: drag ? "none" : "height 280ms var(--ease-inout)" }}
    >
      <button
        type="button"
        aria-label={`Resize panel, currently ${snap}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onClick={(e) => e.detail === 0 && cycle()}
        onDoubleClick={cycle}
        className="flex h-7 w-full shrink-0 touch-none items-center justify-center"
      >
        <span className="h-1.5 w-10 rounded-full bg-strong-line" />
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">{children}</div>
    </section>
  );
}
