"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Page } from "@/components/Page";
import { Button } from "@/components/Button";
import { Input, Label } from "@/components/Field";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { User } from "@/lib/types";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const signIn = useSession((s) => s.signIn);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string; user: User }>("/auth/login", { method: "POST", json: { email, password } });
      signIn(res.token, res.user);
      const next = params.get("next");
      router.replace(next && next.startsWith("/") ? next : res.user.role === "admin" ? "/admin" : "/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Staff sign in" intro="Riders do not need an account. Staff sign in to run the simulation.">
      <form onSubmit={submit} className="card max-w-sm space-y-4 p-5" aria-describedby={error ? "login-error" : undefined}>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p id="login-error" role="alert" className="text-sm text-critical">{error}</p>}
        <Button type="submit" variant="primary" disabled={busy} className="w-full">{busy ? "Signing in…" : "Sign in"}</Button>
        {process.env.NODE_ENV === "development" && (
          <p className="text-xs text-ink-3">
            Development accounts: admin@aera.dev, operator@aera.dev (Taman Jaya), operator.kls@aera.dev (KL Sentral). Passwords are in backend/.env.example.
          </p>
        )}
      </form>
    </Page>
  );
}
