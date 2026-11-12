import {
  ChatCircleDots, Gauge, Gear, MapPin, MapTrifold, NavigationArrow, Train, UserCircle,
} from "@phosphor-icons/react/dist/ssr";
import type { View } from "@/lib/view";

export interface NavItem {
  href: string;
  label: string;
  icon: typeof Train;
}

const LIVE = { href: "/", label: "Live", icon: Train };
const NETWORK = { href: "/network", label: "Network", icon: MapTrifold };
const PLAN = { href: "/trip", label: "Plan", icon: NavigationArrow };
const ASK = { href: "/ask", label: "Ask", icon: ChatCircleDots };
export const YOU = { href: "/me", label: "You", icon: UserCircle };

const OPS = { href: "/control", label: "Operations", icon: Gauge };
const MAP = { href: "/", label: "Live map", icon: MapPin };
const ADMIN = { href: "/admin", label: "Admin", icon: Gear };

/**
 * The tabs for a view (VIEW-02, OPS-01). Riders: getting about (Live, Network, Plan,
 * Ask); You sits behind the avatar at the top. Staff: one Operations page that holds everything
 * needed to run the line, the live map, Ask and, for admins, Admin. Phones have room for five.
 */
export function navFor(view: View, phone = false, admin = false): NavItem[] {
  if (view === "operator") {
    if (phone) return admin ? [OPS, { ...MAP, label: "Map" }, ASK, ADMIN, YOU] : [OPS, { ...MAP, label: "Map" }, ASK, YOU];
    return admin ? [OPS, MAP, ASK, ADMIN] : [OPS, MAP, ASK];
  }
  return [LIVE, NETWORK, PLAN, ASK];
}

/** The item for this path: the longest href that matches, so /control/analytics is not also Control. */
export function activeHref(path: string, items: NavItem[]): string | null {
  const match = (href: string) => (href === "/" ? path === "/" || path.startsWith("/station") : path === href || path.startsWith(`${href}/`));
  return items.map((i) => i.href).filter(match).sort((a, b) => b.length - a.length)[0] ?? null;
}
