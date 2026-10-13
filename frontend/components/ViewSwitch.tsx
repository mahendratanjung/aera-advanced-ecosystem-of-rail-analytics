"use client";

import { Gauge, Train } from "@phosphor-icons/react/dist/ssr";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { type View, useView, useViewPref } from "@/lib/view";

/** VIEW-01: staff switch between the rider and operator views. Hidden for riders. */
export function ViewSwitch({ dark = false, className = "" }: { dark?: boolean; className?: string }) {
  const user = useSession((s) => s.user);
  const view = useView();
  const set = useViewPref((s) => s.set);
  const router = useRouter();
  if (!user) return null;
  const go = (v: View) => {
    if (v === view) return;
    set(v);
    router.push(v === "operator" ? "/control" : "/");
  };
  const opt = (v: View, label: string, Icon: typeof Train) => {
    const on = view === v;
    const tone = dark ? (on ? "bg-white text-ops" : "text-ops-ink-2 hover:text-ops-ink") : on ? "bg-white text-ink shadow-sm" : "text-ink-3 hover:text-ink";
    return (
      <button type="button" role="radio" aria-checked={on} onClick={() => go(v)}
        className={`pressable flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-bold ${tone}`}>
        <Icon size={15} weight={on ? "fill" : "regular"} aria-hidden />{label}
      </button>
    );
  };
  return (
    <div role="radiogroup" aria-label="View" className={`flex items-center gap-0.5 rounded-full p-1 ${dark ? "bg-ops-2" : "bg-surface-2"} ${className}`}>
      {opt("rider", "Rider", Train)}
      {opt("operator", "Operator", Gauge)}
    </div>
  );
}
