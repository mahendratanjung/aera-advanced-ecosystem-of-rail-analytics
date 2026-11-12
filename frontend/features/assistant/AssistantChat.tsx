"use client";

/**
 * Ask AERA (ASK-01 to ASK-05): a chat that answers from the twin. On the live map it is the
 * card in the left column; on phones it is the /ask page. Answers come with the cards the
 * tools produced (route options, a station, a ride), so the rider can act on them.
 */

import { ArrowRight, Check, Copy, Lightning, MapPin, Microphone, NavigationArrow, PaperPlaneRight, Path, Sparkle, Train, Trash, UsersThree, X } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RouteOptionCard } from "@/features/advisor/RouteOptions";
import { blocksAt } from "@/lib/advisor/advisor";
import { type Turn, useChat } from "@/lib/assistant/chat";
import type { AskRole, Card, ToolCtx } from "@/lib/assistant/tools";
import { useCrowd, useNetCrowd, useNetwork, useSimNetwork, useSimNow } from "@/lib/hooks";
import { useHome } from "@/lib/home";
import { NEAR_KM, nearestStation, useNearby } from "@/lib/nearby";
import { useSession } from "@/lib/session";
import { simNowMs } from "@/lib/sim/clock";
import { NO_DISRUPTIONS, useTwin } from "@/lib/store";

/** Builds the tool context from the latest state each time a tool runs. */
function useToolCtx(): { get: () => ToolCtx | null; ready: boolean } {
  const { engine, line } = useCrowd("KJ");
  const pos = useNearby((s) => s.pos);
  useEffect(() => {
    void useNearby.getState().locate(false);
  }, []);
  const near = useMemo(() => {
    const n = pos && line ? nearestStation(line.stations, pos) : null;
    return n && n.km <= NEAR_KM ? n.station.id : null;
  }, [pos, line]);
  const { ix } = useNetwork();
  const { net } = useSimNetwork();
  const netCrowd = useNetCrowd();
  const user = useSession((s) => s.user);
  const home = useHome((s) => s.id);
  const role: AskRole = user?.role === "admin" ? "admin" : user?.role === "operator" ? "operator" : "rider";
  const get = useCallback((): ToolCtx | null => {
    if (!engine || !ix) return null;
    const s = useTwin.getState();
    return { ix, engine, t: simNowMs(s.sim?.clock, s.offsetMs) / 1000, disruptions: s.sim?.disruptions ?? NO_DISRUPTIONS,
      mult: s.sim?.scenario.demand_mult ?? 1, role, home, near, notices: (s.sim?.notices ?? []).map((n) => n.text), net, netCrowd };
  }, [engine, ix, role, home, near, net, netCrowd]);
  return { get, ready: !!engine && !!ix };
}

/** Plain text with "- " lists and **bold**, rendered without HTML injection. */
function Rich({ text }: { text: string }) {
  const inline = (s: string, key: number): ReactNode => {
    const parts = s.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`)/g);
    return (
      <span key={key}>
        {parts.map((p, i) => p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <strong key={i} className="font-semibold text-ink">{p.slice(2, -2)}</strong>
          : (p.startsWith("*") && p.endsWith("*") && p.length > 2) || (p.startsWith("_") && p.endsWith("_") && p.length > 2) ? <em key={i}>{p.slice(1, -1)}</em>
          : p.startsWith("`") && p.endsWith("`") && p.length > 2 ? <span key={i} className="font-semibold text-ink">{p.slice(1, -1)}</span>
          : p)}
      </span>
    );
  };
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`l${blocks.length}`} className="my-1 list-disc space-y-0.5 pl-5">{list.map((l, i) => <li key={i}>{inline(l, i)}</li>)}</ul>);
    list = [];
  };
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
    if (m) list.push(m[1]);
    else {
      flush();
      if (line.trim()) blocks.push(<p key={`p${blocks.length}`}>{inline(line.replace(/^#+\s*/, ""), 0)}</p>);
    }
  }
  flush();
  return <div className="space-y-1.5">{blocks}</div>;
}

function CardView({ card, names }: { card: Card; names: Record<string, string> }) {
  if (card.kind === "options") {
    const fastest = card.advice.options[0];
    return (
      <div className="mt-2 space-y-2">
        <ol className="space-y-2">
          {card.advice.options.slice(0, 3).map((o) => <RouteOptionCard key={o.id} o={o} best={o === fastest && card.advice.options.length > 1} now={card.now} />)}
        </ol>
      </div>
    );
  }
  const link = card.kind === "station"
    ? { href: `/?station=${card.stationId}`, label: `Open ${card.name} on the map`, Icon: MapPin }
    : { href: `/trip?from=${card.from}&to=${card.to}`, label: `${card.fromName} to ${card.toName} in the planner`, Icon: NavigationArrow };
  return (
    <Link href={link.href} className="pressable mt-2 flex items-center gap-2 rounded-xl border border-rule bg-white px-3 py-2 text-[13px] font-semibold text-accent hover:bg-accent-soft">
      <link.Icon size={16} weight="bold" aria-hidden />
      <span className="flex-1">{link.label}</span>
      <ArrowRight size={14} weight="bold" aria-hidden />
    </Link>
  );
}

/** ASK-06: speak a question (Web Speech API, where the browser has it). Nothing is recorded by AERA. */
interface Recognition {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function useVoice(onText: (t: string) => void) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const rec = useRef<Recognition | null>(null);
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    setSupported(!!(w.SpeechRecognition ?? w.webkitSpeechRecognition));
  }, []);
  const toggle = () => {
    if (listening) return rec.current?.stop();
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Rec = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Rec) return;
    const r = new Rec();
    r.lang = "en-MY";
    r.interimResults = true;
    r.onresult = (e) => onText(Array.from(e.results).map((x) => x[0].transcript).join(""));
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };
  return { supported, listening, toggle };
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" aria-label={done ? "Copied" : "Copy this answer"} title="Copy"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }).catch(() => {});
      }}
      className="flex h-7 w-7 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink">
      {done ? <Check size={14} weight="bold" aria-hidden /> : <Copy size={14} aria-hidden />}
    </button>
  );
}

function Bubble({ turn, names }: { turn: Turn; names: Record<string, string> }) {
  if (turn.role === "user") {
    return <li className="ml-10 max-w-[85%] self-end break-words rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[14px] text-white">{turn.text}</li>;
  }
  return (
    <li className="min-w-0 pr-4">
      <div className="w-fit max-w-full break-words rounded-2xl rounded-bl-md bg-surface-2 px-3.5 py-2.5 text-[14px] leading-relaxed text-ink-2">
        <Rich text={turn.text} />
      </div>
      {turn.cards.map((c, i) => <CardView key={i} card={c} names={names} />)}
      <div className="mt-0.5 flex items-center gap-1">
        <CopyButton text={turn.text} />
        {turn.quick && turn.quick !== "off" && (
          <p className="text-[11px] text-ink-3">{turn.quick === "busy" ? "The AI assistant is busy right now, so this is a standard answer." : "The AI assistant is unavailable right now, so this is a standard answer."}</p>
        )}
      </div>
    </li>
  );
}

/** The station questions start from: the one near the rider, else My station. */
function useStartName(): string {
  const { ix } = useNetwork();
  const { line } = useCrowd("KJ");
  const home = useHome((s) => s.id);
  const pos = useNearby((s) => s.pos);
  const n = pos && line ? nearestStation(line.stations, pos) : null;
  const id = n && n.km <= NEAR_KM ? n.station.id : home;
  return ix?.stop[id]?.name ?? "Taman Jaya";
}

function useSuggestions(): string[] {
  const { engine } = useCrowd("KJ");
  const disruptions = useTwin((s) => s.sim?.disruptions ?? NO_DISRUPTIONS);
  const role = useSession((s) => s.user?.role);
  const now = useSimNow(30_000);
  const homeName = useStartName();
  const blocked = engine ? blocksAt(engine, disruptions, now / 1000).length > 0 : false;
  const out: string[] = [];
  if (blocked) out.push(`Trains are not running. How do I get from ${homeName} to ${other(homeName, "KLCC", "KL Sentral")}?`, "What is happening on the line?");
  else out.push(`When is the next train at ${homeName}?`, `How full is the ride from ${homeName} to ${other(homeName, "KL Sentral", "KLCC")}?`);
  out.push("How busy is the MRT right now?", `When is it quieter to go from ${homeName} to ${other(homeName, "Pasar Seni", "Kelana Jaya")}?`, `How do I get from ${homeName} to Bukit Bintang?`);
  if (role === "operator" || role === "admin") out.unshift("Give me a line overview");
  return out.slice(0, 4);
}

/** A destination that is not where the rider already is. */
const other = (home: string, want: string, instead: string) => (home === want ? instead : want);

const CAPABILITIES = [
  { icon: Train, title: "Next trains", ask: (home: string) => `When is the next train at ${home}?` },
  { icon: UsersThree, title: "Crowding", ask: (home: string) => `How full is the ride from ${home} to ${other(home, "KL Sentral", "KLCC")}?` },
  { icon: Lightning, title: "Quieter times", ask: (home: string) => `When is it quieter to go from ${home} to ${other(home, "Pasar Seni", "Kelana Jaya")}?` },
  { icon: Path, title: "Alternative routes", ask: (home: string) => `How do I get from ${home} to Bukit Bintang?` },
];

/** ASK-07: the empty state on /ask: a greeting and what AERA can answer, each as a question to tap. */
function Welcome({ onAsk, ready }: { onAsk: (q: string) => void; ready: boolean }) {
  const now = useSimNow(60_000);
  const homeName = useStartName();
  const h = (((now / 1000 + 8 * 3600) % 86400) + 86400) % 86400 / 3600;
  const hello = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return (
    <div className="flex flex-col items-center px-1 pb-3 pt-2 text-center sm:pt-10">
      <span aria-hidden className="hero-gradient hidden h-16 w-16 items-center justify-center rounded-[22px] shadow-lg sm:flex"><Sparkle size={30} weight="fill" /></span>
      <p className="text-[23px] font-extrabold leading-tight tracking-tight text-ink sm:mt-4 sm:text-[30px]">{hello}. Where are you going?</p>
      <p className="mt-1 max-w-md text-[13.5px] leading-relaxed text-ink-2 sm:text-[14px]">
        Ask about departures and predicted crowding on the Kelana Jaya Line, or alternative routes across the Rapid Rail network.
      </p>
      <ul className="mt-4 grid w-full grid-cols-2 gap-2 sm:mt-6">
        {CAPABILITIES.map(({ icon: Icon, title, ask }) => (
          <li key={title}>
            <button type="button" disabled={!ready} onClick={() => onAsk(ask(homeName))}
              className="card pressable flex h-full w-full flex-col items-start gap-2 p-3 text-left hover:border-accent disabled:opacity-50 sm:flex-row sm:gap-3 sm:p-3.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent sm:h-9 sm:w-9"><Icon size={17} weight="fill" aria-hidden /></span>
              <span className="min-w-0">
                <span className="block text-[13px] font-bold text-ink">{title}</span>
                <span className="block text-[12.5px] leading-snug text-ink-2 sm:text-[13px]">{ask(homeName)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AssistantChat({ variant = "page", onClose, initial }: { variant?: "page" | "card"; onClose?: () => void; initial?: string | null }) {
  const { turns, busy, step, enabled, check, send, clear } = useChat();
  const { get, ready } = useToolCtx();
  const { ix } = useNetwork();
  const [text, setText] = useState("");
  const list = useRef<HTMLOListElement>(null);
  const sentInitial = useRef(false);
  const suggestions = useSuggestions();
  const names = useMemo(() => (ix ? Object.fromEntries(Object.values(ix.stop).map((s) => [s.id, s.name])) : {}), [ix]);

  useEffect(() => {
    check();
  }, [check]);
  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [turns.length, busy]);
  // A question in the link waits briefly for the rider's location, so "near me" is right.
  const located = useNearby((s) => s.state !== "idle" && s.state !== "locating");
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setWaited(true), 1500);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    if (initial && ready && enabled !== null && (located || waited) && !sentInitial.current) {
      sentInitial.current = true;
      send(initial, get);
    }
  }, [initial, ready, enabled, located, waited, send, get]);

  const submit = (q: string) => {
    if (!q.trim() || !ready) return;
    send(q, get);
    setText("");
  };
  const voice = useVoice(setText);

  return (
    <section aria-label="Ask AERA" className={`flex min-h-0 flex-col ${variant === "page" ? "h-full" : "h-full max-h-[calc(100vh-260px)]"}`}>
      <header className="flex items-center gap-2 pb-3">
        <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent"><Sparkle size={18} weight="fill" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-extrabold leading-tight text-ink">Ask AERA</h2>
          <p className="flex items-center gap-1.5 text-[11px] text-ink-3">
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-good" : enabled === false ? "bg-warning" : "bg-rule-strong"}`} />
            {enabled ? "AI travel assistant · Kelana Jaya Line" : enabled === false ? "Standard answers · AI assistant offline" : "Connecting…"}
          </p>
        </div>
        {turns.length > 0 && (
          <button type="button" onClick={clear} aria-label="Clear the conversation" title="Clear" className="flex h-9 w-9 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2">
            <Trash size={17} aria-hidden />
          </button>
        )}
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close Ask AERA" className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-ink-2 hover:bg-surface-3">
            <X size={17} weight="bold" aria-hidden />
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
        {turns.length === 0 && (variant === "page" ? <Welcome onAsk={submit} ready={ready} /> : (
          <div className="pb-2">
            <p className="text-[14px] leading-relaxed text-ink-2">
              Ask about the next train, how full a journey will be, or how to travel when service is disrupted. Answers are based on the timetable and AERA&apos;s crowding predictions.
            </p>
          </div>
        ))}
        <ol ref={list} aria-live="polite" className="flex flex-col gap-3 py-2">
          {turns.map((t) => <Bubble key={t.id} turn={t} names={names} />)}
          {busy && (
            <li className="flex items-center gap-2.5 self-start rounded-2xl rounded-bl-md bg-surface-2 px-3.5 py-2.5 text-[13px] font-medium text-ink-2" role="status">
              <span aria-hidden className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent/25 border-t-accent" />
              <span>{step ?? "Thinking"}…</span>
            </li>
          )}
        </ol>
        {!busy && (turns.length > 0 || variant === "card") && (
          <ul aria-label="Suggested questions" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible">
            {suggestions.map((s) => (
              <li key={s} className="shrink-0 sm:shrink">
                <button type="button" onClick={() => submit(s)} disabled={!ready}
                  className="pressable rounded-full border border-rule bg-white px-3 py-1.5 text-left text-[12px] font-semibold text-ink-2 hover:border-accent hover:text-accent disabled:opacity-50">
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form className="mt-2 flex items-end gap-2 border-t border-rule pt-3" onSubmit={(e) => { e.preventDefault(); submit(text); }}>
        <label htmlFor="ask-input" className="sr-only">Your question</label>
        <textarea id="ask-input" rows={1} value={text} onChange={(e) => setText(e.target.value)} maxLength={500}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(text);
            }
          }}
          placeholder={voice.listening ? "Listening…" : "Ask about a train or journey"}
          className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl border border-rule bg-surface-2 px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink-3 focus:border-accent focus:bg-white focus:outline-none" />
        {voice.supported && (
          <button type="button" onClick={voice.toggle} aria-pressed={voice.listening} aria-label={voice.listening ? "Stop listening" : "Ask by voice"}
            className={`pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full border ${voice.listening ? "animate-pulse border-critical bg-critical/10 text-critical" : "border-rule bg-white text-ink-2 hover:text-accent"}`}>
            <Microphone size={18} weight={voice.listening ? "fill" : "regular"} aria-hidden />
          </button>
        )}
        <button type="submit" disabled={!text.trim() || busy || !ready} aria-label="Send"
          className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-white disabled:opacity-40">
          <PaperPlaneRight size={18} weight="fill" aria-hidden />
        </button>
      </form>
      <p className="mt-1.5 text-[10.5px] leading-snug text-ink-3">
        {enabled ? "AI-generated answers may be inaccurate. " : ""}Crowding levels are predictions, not live counts. Please do not include personal information.
      </p>
    </section>
  );
}
