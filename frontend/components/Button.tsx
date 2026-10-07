import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const STYLES: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink shadow-sm hover:brightness-110",
  secondary: "border border-rule bg-white text-ink shadow-sm hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "border border-critical/40 bg-white text-critical hover:bg-critical/5",
};

export function Button({ variant = "secondary", size = "md", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant; size?: "sm" | "md";
}) {
  return (
    <button
      type="button"
      {...rest}
      className={`pressable inline-flex items-center justify-center gap-1.5 rounded-full font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${
        size === "sm" ? "h-9 px-3.5 text-[13px]" : "h-11 px-5 text-sm"
      } ${STYLES[variant]} ${className}`}
    />
  );
}
