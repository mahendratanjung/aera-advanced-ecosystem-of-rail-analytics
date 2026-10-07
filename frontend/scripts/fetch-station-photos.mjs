/**
 * Station photos (PIC-01, PIC-02). For every Kelana Jaya Line station, take the lead photo of
 * its English Wikipedia article, download a 960 px copy from Wikimedia Commons into
 * public/stations/, and record the author and licence in lib/stationPhotos.json.
 *
 *   node scripts/fetch-station-photos.mjs          # all stations, keeps existing photos
 *   node scripts/fetch-station-photos.mjs --force  # download again
 *
 * Photos are stored in the app so the demo works offline. Credits are shown on the cards.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const line = JSON.parse(readFileSync(join(root, "..", "data", "lines", "KJ.json"), "utf8"));
const outDir = join(root, "public", "stations");
const outJson = join(root, "lib", "stationPhotos.json");
const force = process.argv.includes("--force");
const UA = "AERA-student-project/1.0 (UTP technopreneurship; station photos with credit)";

/**
 * Commons files chosen by hand where the article has no usable lead photo (none, a logo, a
 * disambiguation page or no article).
 */
const FILES = {
  KJ4: "Sri Rampai LRT Station.jpg",
  KJ5: "Setiawangsa LRT Station platform (211210).jpg",
  KJ8: "Damai LRT Station platform (220527).jpg",
  KJ14: "Pasar Seni LRT Station platform (211210).jpg",
  KJ15: "KL Sentral LRT Station platform (211110).jpg",
  KJ18: "Kerinchi station (Kelana Jaya Line), Kuala Lumpur.jpg",
  KJ29: "KJ Line SS15 Overall View 1.jpg",
  KJ30: "KJ Line SS 18 LRT Station Overall View 1.jpg",
};

const previous = existsSync(outJson) ? JSON.parse(readFileSync(outJson, "utf8")) : {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET with backoff: Wikimedia answers 429 when asked too quickly. */
async function get(url) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (r.status !== 429 || attempt === 5) return r;
    await sleep(Number(r.headers.get("retry-after")) * 1000 || 2000 * 2 ** attempt);
  }
}

async function json(url) {
  const r = await get(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

function strip(html) {
  return String(html ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

async function leadImage(title) {
  try {
    const s = await json(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
    if (s.type === "disambiguation" || !s.originalimage?.source) return null;
    const file = decodeURIComponent(s.originalimage.source.split("?")[0].split("/").pop()).replace(/^\d+px-/, "");
    if (!/\.(jpe?g|webp)$/i.test(file)) return null; // maps, logos and diagrams are PNG or SVG
    return { file, page: s.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}` };
  } catch (e) {
    if (!String(e.message).startsWith("404")) throw e;
    return null;
  }
}

async function credit(file) {
  const q = new URLSearchParams({
    action: "query", format: "json", prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: "960", titles: `File:${file}`,
  });
  const d = await json(`https://commons.wikimedia.org/w/api.php?${q}`);
  const info = Object.values(d.query.pages)[0]?.imageinfo?.[0];
  if (!info) return null;
  const m = info.extmetadata ?? {};
  return {
    thumb: info.thumburl,
    file: info.descriptionurl,
    author: strip(m.Artist?.value) || "Unknown",
    license: strip(m.LicenseShortName?.value) || "See source",
    licenseUrl: m.LicenseUrl?.value ?? null,
  };
}

mkdirSync(outDir, { recursive: true });
const out = {};
for (const st of line.stations) {
  const target = join(outDir, `${st.id}.jpg`);
  if (!force && previous[st.id] && existsSync(target)) {
    out[st.id] = previous[st.id];
    continue;
  }
  let found = FILES[st.id] ? { file: FILES[st.id], page: null } : null;
  for (const t of [`${st.name} LRT station`, `${st.name} station`]) {
    found ??= await leadImage(t);
  }
  if (!found) {
    console.log(`${st.id} ${st.name}: no photo`);
    continue;
  }
  const c = await credit(found.file);
  if (!c?.thumb) {
    console.log(`${st.id} ${st.name}: no Commons record for ${found.file}`);
    continue;
  }
  const img = await get(c.thumb);
  if (!img.ok) {
    console.log(`${st.id} ${st.name}: download failed (${img.status})`);
    continue;
  }
  writeFileSync(target, Buffer.from(await img.arrayBuffer()));
  out[st.id] = { src: `/stations/${st.id}.jpg`, page: found.page ?? c.file, file: c.file, author: c.author, license: c.license, licenseUrl: c.licenseUrl };
  console.log(`${st.id} ${st.name}: ${c.license}, ${c.author}`);
  writeFileSync(outJson, `${JSON.stringify(out, null, 2)}\n`);
  await sleep(1200);
}
writeFileSync(outJson, `${JSON.stringify(out, null, 2)}\n`);
console.log(`${Object.keys(out).length}/${line.stations.length} stations have a photo`);
