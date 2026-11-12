/**
 * What Ask AERA is doing while it works (ASK-09): one plain line per tool the model asked for,
 * so the rider sees progress ("Checking the next trains at KL Sentral") instead of dots.
 */

/** A rider-readable line for a tool the model asked for. */
export function stepText(name: string, a: Record<string, unknown>): string {
  const s = (k: string) => (typeof a[k] === "string" && a[k] ? String(a[k]) : "");
  switch (name) {
    case "service_status": return "Checking how the line is running";
    case "find_station": return `Looking up ${s("query") || "the station"}`;
    case "next_trains": return `Checking the next trains at ${s("station") || "the station"}`;
    case "plan_ride": return `Working out the trains from ${s("from") || "there"} to ${s("to") || "there"}`;
    case "other_ways": return `Finding ways from ${s("from") || "there"} to ${s("to") || "there"}`;
    case "best_time": return `Looking at a typical week for ${s("from") || "the ride"}${s("to") ? ` to ${s("to")}` : ""}`;
    case "line_overview": return "Reading every train on the line";
    case "other_lines": return `Checking how busy ${s("line") || "the other lines"} usually ${s("line") ? "is" : "are"}`;
    default: return "Checking the twin";
  }
}
