import { ChartLineUp, Info, NavigationArrow, Train } from "@phosphor-icons/react/dist/ssr";

export const NAV = [
  { href: "/", label: "Live", icon: Train },
  { href: "/trip", label: "Plan", icon: NavigationArrow },
  { href: "/insights", label: "Insights", icon: ChartLineUp },
  { href: "/about", label: "About", icon: Info },
];

export function isActive(path: string, href: string) {
  return href === "/" ? path === "/" || path.startsWith("/station") : path.startsWith(href);
}
