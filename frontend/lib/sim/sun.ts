/**
 * Where the sun is over the line at a sim time, so the 3D map can be lit like the real sky
 * (low-precision solar position, good to about a degree, which is plenty for lighting).
 */

const RAD = Math.PI / 180;

export interface Sun {
  /** Degrees above the horizon (negative below). */
  altitude: number;
  /** Degrees clockwise from north. */
  azimuth: number;
}

export function sunPosition(ms: number, lat: number, lon: number): Sun {
  const d = ms / 86400000 + 2440587.5 - 2451545.0; // days since J2000
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const l = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l));
  const dec = Math.asin(Math.sin(e) * Math.sin(l));
  const gmst = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const h = (gmst * 15 + lon) * RAD - ra;
  const phi = lat * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h));
  const az = Math.atan2(-Math.cos(dec) * Math.sin(h), Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.sin(phi) * Math.cos(h));
  return { altitude: alt / RAD, azimuth: ((az / RAD) + 360) % 360 };
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export interface Daylight {
  /** 0 in full daylight, 1 at night. */
  night: number;
  /** Peaks at sunrise and sunset, for the warm horizon. */
  dusk: number;
  phase: "Day" | "Dawn" | "Dusk" | "Night";
}

/** Daylight from the sun's altitude: full day above 4°, full night below civil twilight (-8°). */
export function daylight(sun: Sun): Daylight {
  const night = 1 - smoothstep(-8, 4, sun.altitude);
  const dusk = Math.max(0, 1 - Math.abs(sun.altitude + 1) / 8);
  const phase = sun.altitude > 4 ? "Day" : sun.altitude < -6 ? "Night" : sun.azimuth < 180 ? "Dawn" : "Dusk";
  return { night, dusk, phase };
}
