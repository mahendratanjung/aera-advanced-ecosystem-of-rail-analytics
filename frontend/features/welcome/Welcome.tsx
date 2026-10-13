"use client";

/**
 * Welcome (ONB-01 to ONB-04): four short steps on a rider's first visit. What AERA does, the
 * five crowding words, picking a station, and the optional location sharing. Every step can
 * be skipped; the answers are kept in this browser. Shown again from the You page.
 */

import { ArrowLeft, ArrowRight, Broadcast, Crosshair, MagnifyingGlass, MapTrifold, Sparkle, Train, UsersThree } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CrowdScale } from "@/components/Crowd";
import { Logo } from "@/components/TopBar";
import { distanceKm } from "@/features/live/MapChrome";
import { BRAND } from "@/lib/brand";
import { useHome } from "@/lib/home";
import { useLine } from "@/lib/hooks";
import { usePrefs } from "@/lib/prefs";

/** A small Kelana Jaya Line with trains gliding along it, each in a crowding colour. */
function HeroArt() {
  const stops = [40, 110, 180, 250, 320];
  const trains = [
    { c: "var(--crowd-1)", d: "0s" },
    { c: "var(--crowd-3)", d: "-2.6s" },
    { c: "var(--crowd-2)", d: "-5.2s" },
  ];
  return (
    <svg viewBox="0 0 360 150" className="w-full max-w-[420px]" aria-hidden>
      <defs>
        <style>{`
          @keyframes aera-ride { from { transform: translateX(40px); } to { transform: translateX(320px); } }
          .aera-train { animation: aera-ride 7.8s linear infinite; }
          @media (prefers-reduced-motion: reduce) { .aera-train { animation: none; } }
        `}</style>
      </defs>
      <rect x="8" y="20" width="344" height="110" rx="28" fill="var(--accent-soft)" />
      <path d="M40 75 H320" stroke="var(--line-kj)" strokeWidth="10" strokeLinecap="round" />
      {stops.map((x, i) => (
        <g key={x}>
          <circle cx={x} cy={75} r={i === 2 ? 8 : 5.5} fill="#fff" stroke={i === 2 ? "var(--net-ink)" : "none"} strokeWidth="2.5" />
          <rect x={x - 14} y={96} width={28} height={6} rx={3} fill="var(--rule-strong)" opacity={0.7} />
        </g>
      ))}
      {trains.map((t, i) => (
        <g key={i} className="aera-train" style={{ animationDelay: t.d }}>
          <rect x={-17} y={i % 2 ? 51 : 82} width={34} height={14} rx={7} fill={t.c} stroke="#fff" strokeWidth="2.5" />
        </g>
      ))}
      <g transform="translate(286 30)">
        <rect width="58" height="24" rx="12" fill="#fff" />
        <circle cx="13" cy="12" r="5" fill="var(--crowd-1)" />
        <text x="23" y="16" fontSize="10.5" fontWeight="700" fill="var(--ink)">Quiet</text>
      </g>
    </svg>
  );
}

function Step({ icon: Icon, eyebrow, title, children }: { icon: typeof Train; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section className="enter" aria-labelledby="welcome-title">
      <p className="flex items-center gap-2 text-[13px] font-bold text-accent"><Icon size={17} weight="fill" aria-hidden />{eyebrow}</p>
      <h1 id="welcome-title" className="mt-2 text-[30px] font-extrabold leading-[1.1] tracking-tight text-ink sm:text-[38px]">{title}</h1>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Welcome() {
  const router = useRouter();
  const { line } = useLine("KJ");
  const home = useHome((s) => s.id);
  const setHome = useHome((s) => s.set);
  const { setWelcomed, setShare, share, load } = usePrefs();
  const [step, setStep] = useState(0);
  const [q, setQ] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const LAST = 3;

  useEffect(() => load(), [load]);

  const stations = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (line?.stations ?? []).filter((s) => !k || s.name.toLowerCase().includes(k) || s.id.toLowerCase() === k);
  }, [line, q]);

  const finish = () => {
    setWelcomed(true);
    router.replace("/");
  };

  const nearMe = () => {
    setNote(null);
    if (!line || !navigator.geolocation) return setNote("Location is not available here, so pick from the list.");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const near = [...line.stations].sort((a, b) => distanceKm(p.coords.latitude, p.coords.longitude, a.lat, a.lon) - distanceKm(p.coords.latitude, p.coords.longitude, b.lat, b.lon))[0];
        if (distanceKm(p.coords.latitude, p.coords.longitude, near.lat, near.lon) > 25) setNote("You are far from the Kelana Jaya Line, so pick from the list.");
        else {
          setHome(near.id);
          setNote(`Nearest station: ${near.name}.`);
        }
      },
      () => setNote("Location was not shared, so pick from the list."),
      { timeout: 8000, maximumAge: 300000 },
    );
  };

  return (
    <div className="-mb-[76px] min-h-dvh bg-white lg:mb-0 lg:grid lg:grid-cols-[1.05fr_1fr]">
      <aside className="hero-gradient relative hidden overflow-hidden p-12 lg:flex lg:flex-col lg:justify-between">
        <span className="rounded-2xl bg-white/95 px-3 py-2 self-start"><Logo /></span>
        <div>
          <p className="max-w-md text-[34px] font-extrabold leading-tight tracking-tight">How full is the next train?</p>
          <p className="mt-3 max-w-md text-[16px] leading-relaxed text-white/85">{BRAND.tagline}</p>
        </div>
        <ul className="grid max-w-md gap-3 text-[14px] text-white/90">
          <li className="flex items-center gap-3"><UsersThree size={20} weight="fill" aria-hidden />Crowding for every train and every car</li>
          <li className="flex items-center gap-3"><MapTrifold size={20} weight="fill" aria-hidden />All 13 Klang Valley rail lines on one map</li>
          <li className="flex items-center gap-3"><Sparkle size={20} weight="fill" aria-hidden />Ask AERA when the line breaks down</li>
        </ul>
      </aside>

      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-5 sm:px-8 lg:min-h-0 lg:justify-center">
        <header className="flex items-center justify-between">
          <span className="lg:invisible"><Logo /></span>
          {step < LAST && <button type="button" onClick={finish} className="rounded-full px-3 py-2 text-[14px] font-semibold text-ink-3 hover:bg-surface-2">Skip</button>}
        </header>

        <ol aria-label={`Step ${step + 1} of ${LAST + 1}`} className="mt-6 flex gap-1.5">
          {Array.from({ length: LAST + 1 }, (_, i) => (
            <li key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? "bg-accent" : "bg-surface-3"}`} />
          ))}
        </ol>

        <div className="mt-8 flex-1 lg:flex-none">
          {step === 0 && (
            <Step icon={Train} eyebrow={`Welcome to ${BRAND.name}`} title="Know how full your train is before it arrives">
              <HeroArt />
              <p className="mt-4 text-[16px] leading-relaxed text-ink-2">
                AERA is a digital twin of the LRT Kelana Jaya Line. It follows every train on the timetable and predicts how crowded each one is,
                car by car, so you can pick a calmer train or a better time.
              </p>
            </Step>
          )}
          {step === 1 && (
            <Step icon={UsersThree} eyebrow="Five words for how full" title="Quiet to Packed, always with a word and an icon">
              <div className="card p-4"><CrowdScale /></div>
              <p className="mt-3 text-[14px] text-ink-2">Predicted from recent gate taps on data.gov.my. When riders and train sensors report, AERA blends that in.</p>
            </Step>
          )}
          {step === 2 && (
            <Step icon={Crosshair} eyebrow="Your station" title="Where do you usually get on?">
              <div className="flex gap-2">
                <label className="flex h-12 flex-1 items-center gap-2 rounded-full border border-rule bg-surface-2 px-4 focus-within:border-accent focus-within:bg-white">
                  <MagnifyingGlass size={17} className="text-ink-3" aria-hidden />
                  <span className="sr-only">Find a station</span>
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a station" className="min-w-0 flex-1 bg-transparent text-[15px] text-ink focus:outline-none" />
                </label>
                <button type="button" onClick={nearMe} className="pressable flex h-12 items-center gap-1.5 rounded-full border border-rule bg-white px-4 text-[14px] font-semibold text-accent hover:bg-accent-soft">
                  <Crosshair size={17} weight="bold" aria-hidden />Near me
                </button>
              </div>
              {note && <p role="status" className="mt-2 text-[13px] text-ink-2">{note}</p>}
              <div role="radiogroup" aria-label="Kelana Jaya Line stations" className="mt-3 max-h-[42dvh] overflow-y-auto rounded-2xl border border-rule">
                {!line ? <p className="p-4 text-[14px] text-ink-3">Loading stations…</p> : stations.length === 0 ? <p className="p-4 text-[14px] text-ink-3">No station by that name.</p> : stations.map((s) => (
                  <button key={s.id} type="button" role="radio" aria-checked={home === s.id} onClick={() => setHome(s.id)}
                    className={`flex w-full items-center gap-3 border-b border-rule px-4 py-2.5 text-left last:border-b-0 ${home === s.id ? "bg-accent-soft" : "hover:bg-surface-2"}`}>
                    <span className="num inline-flex h-6 min-w-[42px] items-center justify-center rounded-md bg-line px-2 text-xs font-bold text-white">{s.id}</span>
                    <span className="flex-1 text-[15px] font-semibold text-ink">{s.name}</span>
                    <span aria-hidden className={`h-5 w-5 rounded-full border-2 ${home === s.id ? "border-accent bg-accent shadow-[inset_0_0_0_3px_white]" : "border-rule-strong"}`} />
                  </button>
                ))}
              </div>
            </Step>
          )}
          {step === 3 && (
            <Step icon={Broadcast} eyebrow="Optional" title="Help AERA count, not just predict">
              <p className="text-[16px] leading-relaxed text-ink-2">
                If you share your location while AERA is open, your phone tells AERA which train you are on, and the crowding for everyone gets better.
              </p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-[14px] text-ink-2">
                <li>Only a distance along the line is kept, for a few minutes.</li>
                <li>Your phone gets a new anonymous code every day.</li>
                <li>A train is counted only once several phones are on it.</li>
                <li>You can switch it off any time on the You page.</li>
              </ul>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => { setShare(true); finish(); }}
                  className="pressable flex h-12 items-center justify-center gap-2 rounded-full bg-accent px-5 text-[15px] font-bold text-white">
                  <Broadcast size={18} weight="fill" aria-hidden />Share while open
                </button>
                <button type="button" onClick={() => { setShare(false); finish(); }}
                  className="pressable flex h-12 items-center justify-center rounded-full border border-rule bg-white px-5 text-[15px] font-bold text-ink hover:bg-surface-2">
                  {share ? "Turn it off" : "Not now"}
                </button>
              </div>
            </Step>
          )}
        </div>

        {step < LAST && (
          <footer className="mt-8 flex items-center gap-3">
            {step > 0 && (
              <button type="button" onClick={() => setStep(step - 1)} aria-label="Back"
                className="pressable flex h-12 w-12 items-center justify-center rounded-full border border-rule bg-white text-ink-2 hover:bg-surface-2">
                <ArrowLeft size={18} weight="bold" aria-hidden />
              </button>
            )}
            <button type="button" onClick={() => setStep(step + 1)}
              className="pressable flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-accent px-5 text-[15px] font-bold text-white">
              {step === 0 ? "Get started" : step === 2 ? `Continue with ${line?.stations.find((s) => s.id === home)?.name ?? "this station"}` : "Next"}
              <ArrowRight size={18} weight="bold" aria-hidden />
            </button>
          </footer>
        )}
        {step === 0 && (
          <p className="mt-4 text-center text-[13px] text-ink-3">
            Rapid KL staff? <Link href="/login" className="font-semibold text-accent">Sign in</Link>
          </p>
        )}
      </main>
    </div>
  );
}
