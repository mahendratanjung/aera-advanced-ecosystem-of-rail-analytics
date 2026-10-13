import {
  ChartBar, ChatCircleDots, Clock, Gauge, Gear, MapPin, MapTrifold, NavigationArrow, Pulse, Train, UserCircle,
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
const BUSY = { href: "/insights", label: "Busy times", icon: Clock };
const STATUS = { href: "/status", label: "Status", icon: Pulse };
export const YOU = { href: "/me", label: "You", icon: UserCircle };

const CONTROL = { href: "/control", label: "Control", icon: Gauge };
const MAP = { href: "/", label: "Map", icon: MapPin };
const ANALYTICS = { href: "/control/analytics", label: "Analytics", icon: ChartBar };
const ADMIN = { href: "/admin", label: "Admin", icon: Gear };

/**
 * The tabs for a view (VIEW-02). Riders: getting about (Live, Network, Plan, Busy times, Ask,
 * Status). Operators: running the line (Control, Map, Analytics, Network, Ask, Status, Admin).
 * Phones have room for five, the last always You, where the view switch and the rest live.
 */
export function navFor(view: View, phone = false, admin = false): NavItem[] {
  if (view === "operator") {
    if (phone) return [CONTROL, MAP, ANALYTICS, ASK, YOU];
    return admin ? [CONTROL, MAP, ANALYTICS, NETWORK, ASK, STATUS, ADMIN] : [CONTROL, MAP, ANALYTICS, NETWORK, ASK, STATUS];
  }
  return phone ? [LIVE, NETWORK, PLAN, ASK, YOU] : [LIVE, NETWORK, PLAN, BUSY, ASK, STATUS];
}

/** The item for this path: the longest href that matches, so /control/analytics is not also Control. */
export function activeHref(path: string, items: NavItem[]): string | null {
  const match = (href: string) => (href === "/" ? path === "/" || path.startsWith("/station") : path === href || path.startsWith(`${href}/`));
  return items.map((i) => i.href).filter(match).sort((a, b) => b.length - a.length)[0] ?? null;
}
