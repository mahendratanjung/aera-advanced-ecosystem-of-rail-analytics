const KL = "Asia/Kuala_Lumpur";

export function klTime(ms: number, seconds = false): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: KL,
    hour: "2-digit",
    minute: "2-digit",
    second: seconds ? "2-digit" : undefined,
    hour12: false,
  }).format(ms);
}

export function klDate(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: KL, weekday: "short", day: "numeric", month: "short" }).format(ms);
}

export function klHour(ms: number): number {
  return (((ms / 1000 + 8 * 3600) % 86400) + 86400) % 86400 / 3600;
}

export function minutesUntil(targetS: number, nowMs: number): number {
  return Math.max(0, Math.round((targetS * 1000 - nowMs) / 60000));
}

export function ago(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return "never";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

export function stationName(name: string): string {
  return name;
}
