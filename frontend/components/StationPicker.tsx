"use client";

/**
 * Pick a station (PLAN-05): a button that opens a searchable list, full screen on phones and a
 * panel on desktop, instead of a 37-row native dropdown. My station and recently picked
 * stations come first; typing filters by name or code ("sentral", "KJ15"). Built on <dialog>,
 * so focus, Escape and the back gesture behave like any modal.
 */

import { CaretDown, ClockCounterClockwise, MagnifyingGlass, Star, X } from "@phosphor-icons/react/dist/ssr";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { StationCode } from "@/components/StationCode";
import { useHome } from "@/lib/home";
import { recentStations, rememberStation } from "@/lib/recent";
import { type PickStation, searchStations } from "@/lib/stationSearch";

/** Dark text on light line colours (MRT Putrajaya yellow, Monorail green), white otherwise. */
function inkOn(color: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(color);
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? "var(--ink)" : "#fff";
}

export function StationPicker({ stations, value, onChange, label, variant = "plain", icon }: {
  stations: PickStation[]; value: string; onChange: (id: string) => void; label: string; variant?: "plain" | "field"; icon?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const home = useHome((s) => s.id);
  const titleId = useId();
  const name = stations.find((s) => s.id === value)?.name ?? value;
  const results = useMemo(() => searchStations(stations, q), [stations, q]);
  const byId = useMemo(() => Object.fromEntries(stations.map((s) => [s.id, s])), [stations]);

  const open = () => {
    setQ("");
    setRecent(recentStations().filter((id) => byId[id] && id !== home));
    ref.current?.showModal();
    requestAnimationFrame(() => input.current?.focus());
  };
  const pick = (id: string) => {
    rememberStation(id);
    onChange(id);
    ref.current?.close();
  };
  // Close when the backdrop (the dialog itself, outside the panel) is tapped.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onClick = (e: MouseEvent) => e.target === d && d.close();
    d.addEventListener("click", onClick);
    return () => d.removeEventListener("click", onClick);
  }, []);

  const row = (s: PickStation, lead?: ReactNode) => (
    <li key={`${lead ? "q" : "a"}-${s.id}`}>
      <button type="button" onClick={() => pick(s.id)} aria-current={s.id === value ? "true" : undefined}
        className={`pressable flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 ${s.id === value ? "bg-accent-soft" : ""}`}>
        {lead ?? (s.color
          ? <span className="num inline-flex h-5 min-w-[38px] shrink-0 items-center justify-center rounded-md px-1.5 text-[11px] font-bold leading-none text-white" style={{ background: s.color, color: inkOn(s.color) }}>{s.id}</span>
          : <StationCode id={s.id} size="sm" />)}
        <span className="min-w-0 flex-1 truncate text-[15.5px] font-semibold text-ink">{s.name}</span>
        {lead && <span className="num text-[12px] font-semibold text-ink-3">{s.id}</span>}
      </button>
    </li>
  );

  return (
    <>
      <button type="button" onClick={open} aria-haspopup="dialog" aria-label={`${label}: ${name}. Change station`}
        className={variant === "field"
          ? "pressable flex w-full min-w-0 items-center gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-left hover:bg-surface-3"
          : "pressable flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-surface-2"}>
        {icon}
        <span className="min-w-0 flex-1">
          {variant === "plain" && <span className="block text-[11px] font-semibold text-ink-3">{label}</span>}
          <span className={`block truncate font-bold text-ink ${variant === "plain" ? "text-[17px]" : "text-[15px]"}`}>{name}</span>
        </span>
        {variant === "field" && <CaretDown size={14} className="shrink-0 text-ink-3" aria-hidden />}
      </button>
      <dialog ref={ref} aria-labelledby={titleId}
        className="m-0 h-dvh max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-ink/40 sm:m-auto sm:h-auto sm:max-h-[75vh] sm:w-[440px] sm:rounded-card">
        <div className="flex h-full flex-col bg-white sm:max-h-[75vh] sm:rounded-card sm:shadow-float">
          <div className="safe-top flex items-center gap-2 border-b border-rule px-3 pb-3 pt-3">
            <h2 id={titleId} className="sr-only">{label}</h2>
            <label className="flex h-12 flex-1 items-center gap-2 rounded-full bg-surface-2 px-4 focus-within:ring-2 focus-within:ring-accent">
              <MagnifyingGlass size={18} className="text-ink-3" aria-hidden />
              <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${label}: search stations`} aria-label={`${label}: search stations`}
                enterKeyHint="go" onKeyDown={(e) => e.key === "Enter" && results[0] && pick(results[0].id)}
                className="ring-on-parent min-w-0 flex-1 bg-transparent text-[16px] text-ink placeholder:text-ink-3 focus:outline-none" />
            </label>
            <button type="button" onClick={() => ref.current?.close()} aria-label="Close"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2">
              <X size={20} weight="bold" aria-hidden />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-6">
            {!q && (
              <>
                {byId[home] && (
                  <ul aria-label="My station" className="border-b border-rule">
                    {row(byId[home], <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-highlight-soft text-highlight"><Star size={16} weight="fill" aria-hidden /></span>)}
                  </ul>
                )}
                {recent.length > 0 && (
                  <ul aria-label="Recent" className="border-b border-rule">
                    {recent.map((id) => row(byId[id], <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-3"><ClockCounterClockwise size={16} aria-hidden /></span>))}
                  </ul>
                )}
                <p className="px-4 pb-1 pt-3 text-[12px] font-bold uppercase tracking-wide text-ink-3">All stations</p>
              </>
            )}
            {results.length ? <ul>{results.map((s) => row(s))}</ul>
              : <p className="px-4 py-6 text-[14px] text-ink-2">No station matches &ldquo;{q}&rdquo;.</p>}
          </div>
        </div>
      </dialog>
    </>
  );
}
