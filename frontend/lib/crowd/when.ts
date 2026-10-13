/**
 * Hours of the day in words, for answers like "Calmer before 07:00 and 10:00–16:00" (INS-02).
 * Service runs from about 06:00, so the day is read from FIRST_HOUR to midnight.
 */

export const FIRST_HOUR = 6;

export const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;

/** Runs of consecutive hours that pass a test, as "07:00–09:00", "before 07:00" or "after 20:00". */
export function windows(values: (number | null)[], test: (v: number) => boolean): string[] {
  const out: string[] = [];
  let start: number | null = null;
  for (let h = FIRST_HOUR; h <= 24; h++) {
    const v = h < 24 ? values[h] : null;
    const ok = v !== null && v !== undefined && test(v);
    if (ok && start === null) start = h;
    if (!ok && start !== null) {
      // Plain words at the ends of the day: "before 07:00", "after 20:00".
      out.push(start === FIRST_HOUR && h < 24 ? `before ${hh(h)}` : h === 24 && start > FIRST_HOUR ? `after ${hh(start)}` : `${hh(start)}–${hh(h)}`);
      start = null;
    }
  }
  return out;
}

/** "a", "a and b", "a, b and c". */
export function list(xs: string[]): string {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}
