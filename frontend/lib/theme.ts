/**
 * Bridge from styles/theme.css to canvas code (MapLibre), which cannot use CSS classes.
 * Values are read from the CSS variables so the theme file stays the single source.
 */

export function token(name: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
