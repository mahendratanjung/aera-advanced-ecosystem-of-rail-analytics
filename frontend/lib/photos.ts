/**
 * Station photos from Wikimedia Commons (PIC-01), stored in public/stations and refreshed by
 * `npm run photos`. Every photo is shown with its author and licence.
 */

import data from "./stationPhotos.json";

export interface StationPhoto {
  src: string;
  /** Wikipedia article or Commons file page the photo came from. */
  page: string;
  /** Commons file page, where the full licence terms are. */
  file: string;
  author: string;
  license: string;
  licenseUrl: string | null;
}

const PHOTOS = data as Record<string, StationPhoto>;

export function stationPhoto(id: string): StationPhoto | null {
  return PHOTOS[id] ?? null;
}
