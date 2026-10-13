"use client";

import { CheckCircle, LockSimple, Pulse, Star, WarningOctagon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { KjTimes } from "@/features/network/NetworkView";
import { attachEngine } from "@/lib/crowd/feed";
import { useHome } from "@/lib/home";
import { useCrowd, useMediaQuery, useSimNow } from "@/lib/hooks";
import { NO_DISRUPTIONS, useTwin } from "@/lib/store";
import { AssistantChat } from "./AssistantChat";

/** ASK-08: what the assistant is answering from, beside the chat on wide screens. */
function RightNow() {
  const { line, engine } = useCrowd("KJ");
  const home = useHome((s) => s.id);
  const now = useSimNow(10_000);
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  useEffect(() => {
    if (engine) attachEngine(engine);
  }, [engine]);
  const active = disruptions.filter((d) => d.start_ms <= now && (d.end_ms === null || d.end_ms > now) && d.kind !== "insert");
  const broken = active.some((d) => d.kind === "suspend" || d.kind === "hold");
  const name = line?.stations.find((s) => s.id === home)?.name ?? home;
  return (
    <aside aria-label="Right now" className="space-y-3">
      <Link href="/status" className="card pressable flex items-center gap-3 p-4 hover:border-accent">
        {active.length === 0
          ? <CheckCircle size={22} weight="fill" className="text-good" aria-hidden />
          : <WarningOctagon size={22} weight="fill" className={broken ? "text-critical" : "text-serious"} aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-bold text-ink">{active.length === 0 ? "Kelana Jaya Line: good service" : broken ? "Kelana Jaya Line: part not running" : "Kelana Jaya Line: delays"}</span>
          <span className="block text-[12px] text-ink-3">Service status for every line</span>
        </span>
        <Pulse size={18} className="text-ink-3" aria-hidden />
      </Link>
      <section className="card p-4">
        <h2 className="flex items-center gap-1.5 text-[14px] font-bold text-ink"><Star size={16} weight="fill" className="text-highlight" aria-hidden />Next at {name}</h2>
        <div className="mt-2">{engine && line ? <KjTimes engine={engine} line={line} stationId={home} /> : <p className="text-[13px] text-ink-3">Loading…</p>}</div>
        <Link href="/me" className="mt-2 inline-block text-[12px] font-semibold text-accent">Change my station</Link>
      </section>
      <p className="flex gap-2 px-1 text-[12px] leading-relaxed text-ink-3">
        <LockSimple size={15} className="mt-0.5 shrink-0" aria-hidden />
        Ask AERA does not need your name or location. Do not type personal details: with the AI model on, questions go to OpenRouter.
      </p>
    </aside>
  );
}

/** Full-page chat for phones and direct links (/ask?q=...); on desktop with the live panel beside it. */
export function AskPage() {
  const q = useSearchParams().get("q");
  const wide = useMediaQuery("(min-width: 1024px)");
  return (
    <main className="enter mx-auto flex h-[calc(100dvh-64px-76px-env(safe-area-inset-bottom))] max-w-6xl gap-8 px-4 pt-4 lg:h-[calc(100dvh-64px)] lg:pb-6 lg:pt-8">
      <div className="mx-auto flex min-w-0 max-w-2xl flex-1 flex-col">
        <AssistantChat variant="page" initial={q} />
      </div>
      {wide && <div className="w-80 shrink-0 overflow-y-auto"><RightNow /></div>}
    </main>
  );
}
