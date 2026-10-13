"use client";

import { ArrowLeft, Eye, EyeSlash, Gauge, Megaphone, ShieldCheck, Train, UserCircle, Wrench } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import { Input, Label } from "@/components/Field";
import { Logo } from "@/components/TopBar";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { User } from "@/lib/types";
import { useViewPref } from "@/lib/view";

/**
 * ROLE-01 / LOGIN-01: who is using AERA. Riders need no account; operators and admins sign in.
 * A two-panel card: what staff get on the left, the form on the right. In development the dev
 * accounts open in one click, for demos.
 */
const PERSONAS = [
  { role: "Rider", icon: Train, what: "Next trains, crowding and other ways round. No account.", href: "/" },
  { role: "Operator", icon: Gauge, what: "Control room, analytics, extra trains and notices.", email: "operator@aera.dev", password: "aera-operator" },
  { role: "Admin", icon: Wrench, what: "Plus the simulation, users, settings and audit.", email: "admin@aera.dev", password: "aera-admin" },
] as const;

const STAFF_GETS = [
  { icon: Gauge, text: "Control room: every train on one diagram, trains running, crowded, held and late, and the riders each disruption leaves waiting" },
  { icon: Train, text: "What-if: send an extra train and see the relief before you commit" },
  { icon: Megaphone, text: "Notices to riders, shown on the map and known to Ask AERA" },
  { icon: ShieldCheck, text: "Every staff action is kept in the audit log" },
];

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const signIn = useSession((s) => s.signIn);
  const signOut = useSession((s) => s.signOut);
  const user = useSession((s) => s.user);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = params.get("next");

  const login = async (mail: string, pass: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string; user: User }>("/auth/login", { method: "POST", json: { email: mail, password: pass } });
      signIn(res.token, res.user);
      useViewPref.getState().set("operator");
      router.replace(next && next.startsWith("/") ? next : "/control");
    } catch (err) {
      const msg = (err as Error).message;
      setError(/401|invalid|incorrect/i.test(msg) ? "That email and password do not match a staff account." : msg || "Could not sign in. Is the twin service running?");
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void login(email, password);
  };

  return (
    <main className="enter mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-6 lg:pt-12">
      <Link href="/me" className="mb-4 inline-flex items-center gap-1.5 text-[14px] font-semibold text-ink-2 hover:text-accent">
        <ArrowLeft size={16} weight="bold" aria-hidden />Back
      </Link>
      <div className="card-raised grid overflow-hidden lg:grid-cols-[1fr_1.1fr]">
        <aside className="hero-gradient relative flex flex-col gap-6 p-6 sm:p-8">
          <span className="self-start rounded-2xl bg-white/95 px-3 py-2"><Logo /></span>
          <div>
            <h1 className="text-[28px] font-extrabold leading-tight tracking-tight sm:text-[32px]">Staff sign in</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-white/85">For Rapid KL operators and AERA admins. Riders do not need an account.</p>
          </div>
          <ul className="hidden space-y-3 text-[14px] text-white/90 sm:block">
            {STAFF_GETS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex gap-3"><Icon size={19} weight="fill" className="mt-0.5 shrink-0" aria-hidden />{text}</li>
            ))}
          </ul>
        </aside>

        <div className="p-6 sm:p-8">
          {user ? (
            <div className="rounded-2xl bg-accent-soft p-4 text-[14px] text-ink">
              <p className="flex items-center gap-2 font-semibold"><UserCircle size={20} weight="fill" className="text-accent" aria-hidden />Signed in as {user.email}</p>
              <div className="mt-3 flex gap-2">
                <Link href="/control" className="pressable rounded-full bg-accent px-4 py-2 text-[13px] font-bold text-white">Control room</Link>
                <button type="button" onClick={signOut} className="pressable rounded-full border border-rule bg-white px-4 py-2 text-[13px] font-bold text-ink">Sign out</button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4" aria-describedby={error ? "login-error" : undefined}>
              {next && <p className="rounded-xl bg-surface-2 px-3 py-2 text-[13px] text-ink-2">Sign in to open {next}.</p>}
              <div>
                <Label htmlFor="email">Work email</Label>
                <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@rapidkl.com.my" />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input id="password" type={show ? "text" : "password"} autoComplete="current-password" required value={password}
                    onChange={(e) => setPassword(e.target.value)} className="pr-12" />
                  <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}
                    className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2">
                    {show ? <EyeSlash size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
                  </button>
                </div>
              </div>
              {error && <p id="login-error" role="alert" className="rounded-xl bg-critical/5 px-3 py-2 text-sm text-critical">{error}</p>}
              <Button type="submit" variant="primary" disabled={busy} className="w-full">{busy ? "Signing in…" : "Sign in"}</Button>
              <p className="text-[12.5px] text-ink-3">Forgotten your password? Ask an AERA admin to reset it on the Users page.</p>
            </form>
          )}

          {process.env.NODE_ENV === "development" && (
            <section aria-label="Open AERA as" className="mt-8 border-t border-rule pt-6">
              <h2 className="text-[14px] font-bold text-ink">Open AERA as</h2>
              <ul className="mt-3 grid gap-2 sm:grid-cols-3">
                {PERSONAS.map((p) => (
                  <li key={p.role}>
                    <button type="button" disabled={busy}
                      onClick={() => {
                        if ("href" in p) {
                          signOut(); // a rider has no session
                          router.push(p.href);
                        } else void login(p.email, p.password);
                      }}
                      className="card pressable flex h-full w-full flex-col items-start gap-1 p-3 text-left hover:border-accent">
                      <p.icon size={20} weight="fill" className="text-accent" aria-hidden />
                      <span className="text-[14px] font-bold text-ink">{p.role}</span>
                      <span className="text-[12px] leading-snug text-ink-2">{p.what}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-3">Development only. Accounts: admin@aera.dev, operator@aera.dev (Taman Jaya), operator.kls@aera.dev (KL Sentral); passwords in backend/.env.example.</p>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
