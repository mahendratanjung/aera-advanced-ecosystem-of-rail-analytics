"use client";

import { ArrowLeft, ArrowRight, Eye, EyeSlash, Gauge, Info, LockSimple, SignOut, Train, Warning, Wrench } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { LogoMark } from "@/components/TopBar";
import { ApiError, api } from "@/lib/api";
import { BRAND } from "@/lib/brand";
import { useSession } from "@/lib/session";
import type { User } from "@/lib/types";
import { useViewPref } from "@/lib/view";

/**
 * Staff sign in (ROLE-01, LOGIN-01..03, revision 6). Split screen as in most staff consoles: the
 * product on the left (a live-looking line with trains coloured by crowding), a focused form on
 * the right. No app chrome on this page. The form follows the usual standards: labelled fields
 * with the right autocomplete, show password, a Caps Lock warning, keep me signed in, a plain
 * error that does not say which part was wrong, throttling after repeated mistakes (server),
 * a spinner while signing in, and a clear way out for riders. Dev accounts sign in in one
 * click in development only.
 */

const DEMO = [
  { role: "Operator", icon: Gauge, what: "Operations for Taman Jaya", email: "operator@aera.dev", password: "aera-operator" },
  { role: "Admin", icon: Wrench, what: "Plus simulation, users and audit", email: "admin@aera.dev", password: "aera-admin" },
] as const;

const PROOF = [
  { value: "37", label: "stations in the twin" },
  { value: "4", label: "cars per train, each predicted" },
  { value: "2 h", label: "of crowding ahead" },
];

/** Decorative: the line with trains gliding along it, coloured by how full they are. */
function LineArt() {
  const trains = [
    { y: 46, lv: 1, dur: 26, delay: -3 },
    { y: 46, lv: 3, dur: 26, delay: -12 },
    { y: 46, lv: 2, dur: 26, delay: -20 },
    { y: 86, lv: 4, dur: 30, delay: -6 },
    { y: 86, lv: 2, dur: 30, delay: -17 },
    { y: 86, lv: 5, dur: 30, delay: -25 },
  ];
  return (
    <svg aria-hidden viewBox="0 0 480 132" className="w-full" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="login-fade" x1="0" x2="1">
          <stop offset="0" stopColor="white" stopOpacity="0" />
          <stop offset=".12" stopColor="white" stopOpacity="1" />
          <stop offset=".88" stopColor="white" stopOpacity="1" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <mask id="login-mask"><rect width="480" height="132" fill="url(#login-fade)" /></mask>
      </defs>
      <g mask="url(#login-mask)">
        {[46, 86].map((y) => <rect key={y} x="0" y={y - 2} width="480" height="4" rx="2" fill="white" opacity=".18" />)}
        {Array.from({ length: 13 }, (_, i) => (
          <g key={i}>
            <rect x={14 + i * 37} y="58" width="10" height="16" rx="3" fill="white" opacity=".22" />
          </g>
        ))}
        {trains.map((t, i) => (
          <g key={i} className="login-train" style={{ animationDuration: `${t.dur}s`, animationDelay: `${t.delay}s`, animationDirection: t.y === 86 ? "reverse" : "normal" }}>
            <rect x="0" y={t.y - 7} width="56" height="14" rx="7" fill={`var(--crowd-${t.lv})`} />
            <rect x="6" y={t.y - 3} width="44" height="3" rx="1.5" fill="white" opacity=".55" />
          </g>
        ))}
      </g>
    </svg>
  );
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const signIn = useSession((s) => s.signIn);
  const signOut = useSession((s) => s.signOut);
  const user = useSession((s) => s.user);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const ids = { email: useId(), pass: useId(), err: useId(), caps: useId(), help: useId() };
  const next = params.get("next");
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/control";

  useEffect(() => {
    // A phone keyboard would cover the page, so only focus the field with a mouse and keyboard.
    if (!user && window.matchMedia("(pointer: fine)").matches) emailRef.current?.focus();
  }, [user]);

  const login = async (mail: string, pass: string, keep = remember) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string; user: User }>("/auth/login", { method: "POST", json: { email: mail.trim(), password: pass } });
      signIn(res.token, res.user, keep);
      useViewPref.getState().set("operator");
      router.replace(target);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setError(status === 401 ? "The email address or password is incorrect."
        : status === 429 ? (err as Error).message || "Too many attempts. Please wait a few minutes and try again."
        : "AERA could not be reached. Check your connection and try again.");
      setPassword("");
      setBusy(false);
    }
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError(!email.trim() ? "Enter your work email address." : "Enter your password.");
      return;
    }
    void login(email, password);
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.("CapsLock") ?? false);

  return (
    <main className="-mb-[76px] grid min-h-dvh bg-white lg:mb-0 lg:grid-cols-[1.05fr_1fr]">
      {/* The product: who it is for and what they get */}
      <aside className="relative flex flex-col overflow-hidden px-6 pb-6 pt-[max(1.25rem,env(safe-area-inset-top))] text-white sm:px-10 lg:min-h-dvh lg:px-14 lg:pb-10 lg:pt-12"
        style={{ background: "radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, var(--brand-train) 38%, transparent), transparent 60%), linear-gradient(160deg, var(--brand-tile) 0%, var(--ops) 70%)" }}>
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5" aria-label={`${BRAND.name} home`}>
            <LogoMark className="h-9 w-9 rounded-[10px] shadow-lg ring-1 ring-white/35" />
            <span className="text-[19px] font-extrabold tracking-tight">{BRAND.name}</span>
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide">Operations</span>
          </Link>
          <Link href="/" className="flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-semibold text-white/85 hover:bg-white/10 hover:text-white lg:hidden">
            <ArrowLeft size={14} weight="bold" aria-hidden />Rider app
          </Link>
        </div>
        <div className="mt-6 lg:mt-auto">
          <h1 className="max-w-md text-[26px] font-extrabold leading-[1.12] tracking-tight sm:text-[32px] lg:text-[44px]">
            See every train before it fills up.
          </h1>
          <p className="mt-3 hidden max-w-md text-[15px] leading-relaxed text-white/80 sm:block">
            The Kelana Jaya Line as a digital twin: every train, car by car, with alerts, a two-hour forecast and what-ifs before you act.
          </p>
        </div>
        <div className="mt-6 hidden sm:block lg:mt-10"><LineArt /></div>
        <ul className="mt-6 hidden grid-cols-3 gap-4 border-t border-white/15 pt-6 lg:grid">
          {PROOF.map((p) => (
            <li key={p.label}>
              <p className="num text-[26px] font-extrabold leading-none">{p.value}</p>
              <p className="mt-1 text-[12.5px] leading-snug text-white/70">{p.label}</p>
            </li>
          ))}
        </ul>
      </aside>

      {/* The form */}
      <section className="flex flex-col px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-8 sm:px-10 lg:justify-center lg:px-16">
        <div className="mx-auto w-full max-w-[400px]">
          <Link href="/" className="mb-10 hidden items-center gap-1.5 text-[13.5px] font-semibold text-ink-2 hover:text-accent lg:inline-flex">
            <ArrowLeft size={15} weight="bold" aria-hidden />Back to the rider app
          </Link>

          {user ? (
            <div>
              <h2 className="text-[28px] font-extrabold tracking-tight text-ink">You&apos;re signed in</h2>
              <p className="mt-1 text-[15px] text-ink-2">Signed in as <strong className="font-semibold text-ink">{user.display_name}</strong> ({user.email}).</p>
              <div className="mt-6 flex flex-col gap-2.5">
                <Link href={target} className="pressable flex h-12 items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-bold text-white hover:brightness-110">
                  Continue to Operations<ArrowRight size={17} weight="bold" aria-hidden />
                </Link>
                <button type="button" onClick={signOut} className="pressable flex h-12 items-center justify-center gap-2 rounded-xl border border-rule text-[15px] font-semibold text-ink hover:bg-surface-2">
                  <SignOut size={17} aria-hidden />Sign out
                </button>
              </div>
            </div>
          ) : (
            <>
              <h2 className="text-[28px] font-extrabold tracking-tight text-ink">Staff sign in</h2>
              <p className="mt-1 text-[15px] text-ink-2">For line operators and administrators. Riders do not need an account.</p>
              {next && next !== "/control" && <p className="mt-4 rounded-xl bg-accent-soft px-3.5 py-2.5 text-[13px] font-medium text-accent">Please sign in to continue.</p>}

              <form onSubmit={submit} noValidate className="mt-7 space-y-5" aria-describedby={error ? ids.err : undefined}>
                <div>
                  <label htmlFor={ids.email} className="mb-1.5 block text-[13.5px] font-semibold text-ink">Work email address</label>
                  <input ref={emailRef} id={ids.email} type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false}
                    required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com"
                    aria-invalid={!!error && !email.trim()}
                    className="h-12 w-full rounded-xl border border-rule-strong bg-white px-3.5 text-[16px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15" />
                </div>
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <label htmlFor={ids.pass} className="text-[13.5px] font-semibold text-ink">Password</label>
                    <button type="button" onClick={() => setHelp(!help)} aria-expanded={help} aria-controls={ids.help}
                      className="text-[13px] font-semibold text-accent hover:underline">Forgot password?</button>
                  </div>
                  <div className="relative">
                    <input id={ids.pass} type={show ? "text" : "password"} autoComplete="current-password" required value={password}
                      onChange={(e) => setPassword(e.target.value)} onKeyUp={onKey} onKeyDown={onKey} onBlur={() => setCaps(false)}
                      aria-invalid={!!error && !password} aria-describedby={caps ? ids.caps : undefined}
                      className="h-12 w-full rounded-xl border border-rule-strong bg-white pl-3.5 pr-12 text-[16px] text-ink focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15" />
                    <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}
                      className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink">
                      {show ? <EyeSlash size={19} aria-hidden /> : <Eye size={19} aria-hidden />}
                    </button>
                  </div>
                  {caps && <p id={ids.caps} className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: "var(--crowd-3-ink)" }}><Warning size={14} weight="fill" aria-hidden />Caps Lock is on</p>}
                  {help && (
                    <p id={ids.help} className="mt-2 flex gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-[13px] leading-relaxed text-ink-2">
                      <Info size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                      Passwords are managed by your AERA administrator. Contact them to have your password reset.
                    </p>
                  )}
                </div>

                <label className="flex cursor-pointer select-none items-center gap-2.5 text-[14px] text-ink-2">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-[18px] w-[18px] rounded accent-[var(--accent)]" />
                  Keep me signed in on this device
                </label>

                {error && (
                  <p id={ids.err} role="alert" className="flex gap-2 rounded-xl border border-critical/25 bg-critical/5 px-3.5 py-3 text-[13.5px] leading-snug text-critical">
                    <Warning size={17} weight="fill" className="mt-px shrink-0" aria-hidden />{error}
                  </p>
                )}

                <button type="submit" disabled={busy} aria-busy={busy}
                  className="pressable flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-bold text-white shadow-sm hover:brightness-110 disabled:opacity-70">
                  {busy ? <><span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />Signing in…</> : "Sign in"}
                </button>
              </form>

              <div className="my-7 flex items-center gap-3 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
                <span className="h-px flex-1 bg-rule" />or<span className="h-px flex-1 bg-rule" />
              </div>
              <Link href="/" className="pressable flex h-12 items-center justify-center gap-2 rounded-xl border border-rule text-[15px] font-semibold text-ink hover:bg-surface-2">
                <Train size={18} aria-hidden />Continue without signing in
              </Link>

              {process.env.NODE_ENV === "development" && (
                <section aria-label="Demo accounts" className="mt-8 rounded-2xl border border-dashed border-rule-strong p-3.5">
                  <p className="text-[12px] font-bold uppercase tracking-wide text-ink-3">Demo accounts · Development only</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {DEMO.map((d) => (
                      <button key={d.role} type="button" disabled={busy} onClick={() => void login(d.email, d.password, true)}
                        className="pressable flex items-start gap-2 rounded-xl bg-surface-2 p-2.5 text-left hover:bg-surface-3 disabled:opacity-60">
                        <d.icon size={18} weight="fill" className="mt-0.5 shrink-0 text-accent" aria-hidden />
                        <span className="min-w-0">
                          <span className="block text-[13.5px] font-bold text-ink">{d.role}</span>
                          <span className="block text-[11.5px] leading-snug text-ink-3">{d.what}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          <p className="mt-8 flex gap-2 text-[12px] leading-relaxed text-ink-3">
            <LockSimple size={15} className="mt-px shrink-0" aria-hidden />
            <span>Authorised personnel only. Activity is logged, and sign-in is paused for 10 minutes after repeated failed attempts.</span>
          </p>
          <nav aria-label="Legal" className="mt-4 flex gap-4 text-[12.5px] font-semibold text-ink-3">
            <span className="ml-auto font-normal">© 2026 {BRAND.name}</span>
          </nav>
        </div>
      </section>
    </main>
  );
}
