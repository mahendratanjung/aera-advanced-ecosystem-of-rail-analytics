"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "./session";
import type { Role, User } from "./types";

/** Redirects to sign in when there is no session, and reports whether the role is allowed. */
export function useRequireRole(role?: Role): { user: User | null; allowed: boolean; ready: boolean } {
  const { user, ready } = useSession();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (ready && !user) router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [ready, user, router, path]);
  const allowed = !!user && (!role || user.role === role || user.role === "admin");
  return { user, allowed, ready };
}
