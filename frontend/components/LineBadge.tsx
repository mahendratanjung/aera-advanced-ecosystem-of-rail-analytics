import type { LineDef } from "@/lib/network/schematic";

/** The poster's numbered circle for a line, in the line's colour. */
export function LineBadge({ line, size = 24, className = "" }: { line: Pick<LineDef, "badge" | "color" | "inkBadge" | "name">; size?: number; className?: string }) {
  return (
    <span aria-label={line.name} title={line.name}
      className={`num inline-flex shrink-0 items-center justify-center rounded-full font-extrabold leading-none ${className}`}
      style={{ width: size, height: size, fontSize: size * (line.badge.length > 1 ? 0.42 : 0.5), background: `var(${line.color})`, color: line.inkBadge ? "var(--ink)" : "#fff" }}>
      {line.badge}
    </span>
  );
}
