#!/usr/bin/env node
// AERA brand kit. The Express mark is drawn once here and written out as:
//   brand/logo/      SVG, PNG, PDF and ICO files in every version and lockup
//   brand/mockups/   the logo in use (PNG renders for reports and slides)
//   brand/guideline/ AERA_Brand_Guideline.pdf and its HTML source
//   frontend/        public/icon.svg, public/icons/*.png and app/favicon.ico for the app
// Needs Google Chrome (set CHROME if it is not in /Applications) and frontend/node_modules (sharp).
// Run from the repo root: node brand/build.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const sharp = createRequire(join(root, "frontend", "package.json"))("sharp");
const W = JSON.parse(readFileSync(join(here, "tools", "wordmark.json"), "utf8"));
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const VERSION = "1.0";

// ---------------------------------------------------------------------------------------------
// Colour (tile, train and ink match --brand-* and --ink in frontend/styles/theme.css)
// ---------------------------------------------------------------------------------------------

const C = {
  blue: "#1149b8",
  navy: "#0a3180",
  sky: "#38bdf8",
  skyDeep: "#0284c7",
  ink: "#0e1726",
  white: "#ffffff",
  orange: "#f97316",
  ops: "#0b1f44",
  lineKJ: "#d50032",
  crowd: ["#10b981", "#fbbf24", "#f97316", "#e11d48"],
};

// ---------------------------------------------------------------------------------------------
// The Express mark on a 64-unit grid. One module, m = 7 units, sets the apex, the legs and the
// train's height. The A stands from y 15 to 48; the train runs from y 31 to 38 and noses out to 56.
// ---------------------------------------------------------------------------------------------

const G = {
  a: "M12 48L24 15H31L43 48H36L27.5 24.63L19 48Z",
  train: "M17 31H41C49.25 31 54.8 33.8 56 38H17Z",
  cab: "M40.4 32.54H45.5C48.5 32.54 50.9 33.66 52.1 34.64H40.4Z",
  side: "M25.4 32.6H28.8A.8.8 0 0 1 29.6 33.4V34A.8.8 0 0 1 28.8 34.8H25.4A.8.8 0 0 1 24.6 34V33.4A.8.8 0 0 1 25.4 32.6Z",
  speed: [
    { x: 8.5, y: 31, w: 7, op: 0.7 },
    { x: 5, y: 35, w: 9.5, op: 0.4 },
  ],
  bbox: { x: 5, y: 15, w: 51, h: 33 },
};

// tile: "rounded" | "square" | null. gap: cut the train back from the A (one-colour versions).
const V = {
  mark: { tile: "rounded", a: C.white, train: C.sky, speed: true, fade: true, side: true },
  small: { tile: "rounded", a: C.white, train: C.sky, speed: false, side: false, dx: -2 },
  onLight: { a: C.navy, train: C.skyDeep, speed: true, fade: true, side: true },
  onDark: { a: C.white, train: C.sky, speed: true, fade: true, side: true },
  monoBlack: { a: "#000000", train: "#000000", speed: true, side: true, gap: true },
  monoWhite: { a: "#ffffff", train: "#ffffff", speed: true, side: true, gap: true },
  maskable: { tile: "square", a: C.white, train: C.sky, speed: true, fade: true, side: true, scale: 0.8 },
  square: { tile: "square", a: C.white, train: C.sky, speed: true, fade: true, side: true },
};

let uid = 0;
function markBody(v, id = `m${++uid}`) {
  let out = "";
  if (v.tile) {
    const [c1, c2] = v.tileColors ?? [C.blue, C.navy];
    out += `<defs><linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>`;
    out += `<rect width="64" height="64"${v.tile === "rounded" ? ' rx="16"' : ""} fill="url(#${id}g)"/>`;
  }
  const tf = [v.scale && `translate(32 32) scale(${v.scale}) translate(-32 -32)`, v.dx && `translate(${v.dx} 0)`].filter(Boolean).join(" ");
  let g = "";
  if (v.gap) {
    g += `<mask id="${id}k" maskUnits="userSpaceOnUse" x="-8" y="-8" width="80" height="80"><rect x="-8" y="-8" width="80" height="80" fill="#fff"/><path d="${G.a}" stroke="#000" stroke-width="2.4" stroke-linejoin="round"/></mask>`;
  }
  if (v.speed) {
    for (const s of G.speed) {
      g += `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="2" rx="1" fill="${v.train}"${v.fade ? ` opacity="${s.op}"` : ""}/>`;
    }
  }
  g += `<path d="${G.train}${G.cab}${v.side ? G.side : ""}" fill-rule="evenodd" fill="${v.trainColor ?? v.train}"${v.gap ? ` mask="url(#${id}k)"` : ""}/>`;
  g += v.outline ? `<path d="${G.a}" fill="none" stroke="${v.a}" stroke-width="1.2"/>` : `<path d="${G.a}" fill="${v.a}"/>`;
  return out + (tf ? `<g transform="${tf}">${g}</g>` : g);
}

// Untiled versions are cropped to the drawing; tiled ones keep the 64-unit square.
const markBox = (v) => (v.tile ? [0, 0, 64, 64] : [G.bbox.x, G.bbox.y, G.bbox.w, G.bbox.h]);

function markSvg(v, { width, height, attrs = "", file = false } = {}) {
  const box = markBox(v);
  const size = width ? ` width="${width}" height="${height ?? (width * box[3]) / box[2]}"` : "";
  const ns = file ? ' xmlns="http://www.w3.org/2000/svg"' : "";
  return `<svg${ns} viewBox="${box.join(" ")}"${size} ${attrs}>${markBody(v)}</svg>`;
}

// ---------------------------------------------------------------------------------------------
// Wordmark (outlined Plus Jakarta Sans, see tools/wordmark.py) and lockups
// ---------------------------------------------------------------------------------------------

const textWidth = (key, cap) => (W[key].width * cap) / W[key].capHeight;
const text = (key, x, baseline, cap, fill) =>
  `<path transform="translate(${+x.toFixed(2)} ${+baseline.toFixed(2)}) scale(${+(cap / W[key].capHeight).toFixed(6)})" d="${W[key].d}" fill="${fill}"/>`;

// Every lockup aligns the wordmark to the A: cap height to the apex, baseline to the feet.
// Reverse lockups (white text, for navy and dark backgrounds) drop the tile, which would vanish
// into the background, and use the untiled mark cropped to the drawing (51 x 33 units).
const isWhite = (c) => ["#fff", "#ffffff"].includes(c.toLowerCase());
const untiled = (v, x, y) => `<g transform="translate(${x - G.bbox.x} ${y - G.bbox.y})">${markBody(v)}</g>`;
const LOCKUPS = {
  horizontal: (ink) => {
    if (isWhite(ink)) return LOCKUPS.mono(ink, null, V.onDark);
    const w = 80 + textWidth("wordmark", 33);
    return { box: [0, 0, w, 64], body: markBody(V.mark) + text("wordmark", 80, 48, 33, ink) };
  },
  tagline: (ink, sub) => {
    if (isWhite(ink)) {
      const w = G.bbox.w + 12 + Math.max(textWidth("wordmark", 22), textWidth("tagline", 5.6));
      const x = G.bbox.w + 12;
      return { box: [0, 0, w, 34.5], body: untiled(V.onDark, 0, 0) + text("wordmark", x, 22, 22, ink) + text("tagline", x, 33, 5.6, sub) };
    }
    const w = 80 + Math.max(textWidth("wordmark", 22), textWidth("tagline", 5.6));
    return {
      box: [0, 0, w, 64],
      body: markBody(V.mark) + text("wordmark", 80, 37, 22, ink) + text("tagline", 80, 48, 5.6, sub),
    };
  },
  stacked: (ink, sub) => {
    const tw = textWidth("tagline", 5.6);
    const ww = textWidth("wordmark", 26);
    if (isWhite(ink)) {
      const w = Math.max(G.bbox.w, ww, tw);
      return {
        box: [0, 0, w, 87],
        body: untiled(V.onDark, (w - G.bbox.w) / 2, 0) + text("wordmark", (w - ww) / 2, 73, 26, ink) + text("tagline", (w - tw) / 2, 85, 5.6, sub),
      };
    }
    const w = Math.max(64, ww, tw);
    return {
      box: [0, 0, w, 118],
      body:
        `<g transform="translate(${(w - 64) / 2} 0)">${markBody(V.mark)}</g>` +
        text("wordmark", (w - ww) / 2, 104, 26, ink) +
        text("tagline", (w - tw) / 2, 116, 5.6, sub),
    };
  },
  wordmark: (ink) => ({ box: [0, -0.5, textWidth("wordmark", 33), 34], body: text("wordmark", 0, 33, 33, ink) }),
  mono: (ink, _sub, v = ink === "#000000" ? V.monoBlack : V.monoWhite) => {
    const w = G.bbox.w + 12 + textWidth("wordmark", 33);
    return { box: [0, 0, w, 33], body: untiled(v, 0, 0) + text("wordmark", G.bbox.w + 12, 33, 33, ink) };
  },
};

function lockupSvg(kind, ink, sub, { width, file = false, attrs = "" } = {}) {
  const { box, body } = LOCKUPS[kind](ink, sub ?? ink);
  const size = width ? ` width="${width}" height="${+((width * box[3]) / box[2]).toFixed(1)}"` : "";
  const ns = file ? ' xmlns="http://www.w3.org/2000/svg"' : "";
  return `<svg${ns} viewBox="${box.map((n) => +n.toFixed(2)).join(" ")}"${size} ${attrs}>${body}</svg>`;
}

// ---------------------------------------------------------------------------------------------
// Logo files
// ---------------------------------------------------------------------------------------------

const SUB = "#475569";
const SUB_DARK = "#b9c7e4";
const FILES = [
  // [file, svg, what it is for]
  ["aera-mark", () => markSvg(V.mark, { file: true }), "Primary mark on its tile. App icon, social avatar, slides, anywhere."],
  ["aera-mark-small", () => markSvg(V.small, { file: true }), "Simplified mark for 24 px and below (favicon, tabs, notifications)."],
  ["aera-mark-on-light", () => markSvg(V.onLight, { file: true }), "Mark without the tile, for white and light backgrounds in documents."],
  ["aera-mark-on-dark", () => markSvg(V.onDark, { file: true }), "Mark without the tile, for navy and dark backgrounds."],
  ["aera-mark-mono-black", () => markSvg(V.monoBlack, { file: true }), "One colour, black. Fax, stamps, engraving, single-colour print."],
  ["aera-mark-mono-white", () => markSvg(V.monoWhite, { file: true }), "One colour, white. Over dark photos or for foil and embossing."],
  ["aera-mark-maskable", () => markSvg(V.maskable, { file: true }), "Full-bleed square with the mark in the safe zone (Android adaptive icons)."],
  ["aera-lockup-horizontal", () => lockupSvg("horizontal", C.ink, null, { file: true }), "Mark and wordmark side by side. The default lockup."],
  ["aera-lockup-horizontal-reverse", () => lockupSvg("horizontal", C.white, null, { file: true }), "Horizontal lockup for dark backgrounds."],
  ["aera-lockup-tagline", () => lockupSvg("tagline", C.ink, SUB, { file: true }), "Horizontal lockup with the full name. Covers, title slides, posters."],
  ["aera-lockup-tagline-reverse", () => lockupSvg("tagline", C.white, SUB_DARK, { file: true }), "Tagline lockup for dark backgrounds."],
  ["aera-lockup-stacked", () => lockupSvg("stacked", C.ink, SUB, { file: true }), "Mark above the wordmark. Square spaces, splash screens, badges."],
  ["aera-lockup-stacked-reverse", () => lockupSvg("stacked", C.white, SUB_DARK, { file: true }), "Stacked lockup for dark backgrounds."],
  ["aera-wordmark", () => lockupSvg("wordmark", C.ink, null, { file: true }), "Wordmark alone, when the mark is already on the page."],
  ["aera-lockup-mono-black", () => lockupSvg("mono", "#000000", null, { file: true }), "One-colour lockup, black."],
  ["aera-lockup-mono-white", () => lockupSvg("mono", "#ffffff", null, { file: true }), "One-colour lockup, white."],
];

const PNG_SIZES = { "aera-mark": [64, 128, 256, 512, 1024], "aera-mark-small": [16, 24, 32, 48] };

function viewBoxOf(svg) {
  const [, , w, h] = svg.match(/viewBox="([^"]+)"/)[1].split(" ").map(Number);
  return { w, h };
}

async function png(svg, out, width) {
  const { w, h } = viewBoxOf(svg);
  const height = Math.round((width * h) / w);
  await sharp(Buffer.from(svg), { density: Math.min(72 * (width / w) * 2, 20000) })
    .resize(width, height)
    .png()
    .toFile(out);
  return out;
}

function ico(entries) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const dir = entries.map(({ size, buf }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    return e;
  });
  return Buffer.concat([head, ...dir, ...entries.map((e) => e.buf)]);
}

const tmp = mkdtempSync(join(tmpdir(), "aera-brand-"));
let tmpN = 0;
function chrome(args) {
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files", "--no-pdf-header-footer", "--virtual-time-budget=6000", ...args], { stdio: "ignore" });
}
function htmlFile(html, dir = tmp) {
  const f = join(dir, `page-${++tmpN}.html`);
  writeFileSync(f, html);
  return f;
}
function pdfOf(svg, out) {
  const { w, h } = viewBoxOf(svg);
  const s = 512 / Math.max(w, h);
  const [pw, ph] = [Math.round(w * s), Math.round(h * s)];
  const sized = svg.replace("<svg", `<svg width="${pw}" height="${ph}"`);
  chrome([`--print-to-pdf=${out}`, pathToFileURL(htmlFile(`<!doctype html><style>@page{size:${pw}px ${ph}px;margin:0}html,body{margin:0}svg{display:block}</style>${sized}`)).href]);
}
function screenshot(html, out, w, h) {
  chrome([`--window-size=${w},${h}`, "--force-device-scale-factor=2", `--screenshot=${out}`, pathToFileURL(htmlFile(html)).href]);
}

const dirs = ["logo/svg", "logo/png", "logo/pdf", "mockups", "guideline"].map((d) => join(here, d));
dirs.forEach((d) => mkdirSync(d, { recursive: true }));
const [SVG_DIR, PNG_DIR, PDF_DIR, MOCK_DIR, GUIDE_DIR] = dirs;

for (const [name, make] of FILES) {
  const svg = make() + "\n";
  writeFileSync(join(SVG_DIR, `${name}.svg`), svg);
  for (const size of PNG_SIZES[name] ?? []) await png(svg, join(PNG_DIR, `${name}-${size}.png`), size);
  if (!PNG_SIZES[name]) await png(svg, join(PNG_DIR, `${name}.png`), name.startsWith("aera-mark") ? 1024 : 2400);
}
await png(markSvg(V.square, { file: true }), join(PNG_DIR, "aera-app-icon-ios-1024.png"), 1024);
await png(markSvg(V.maskable, { file: true }), join(PNG_DIR, "aera-social-avatar-1080.png"), 1080);
for (const name of ["aera-mark", "aera-lockup-horizontal", "aera-lockup-tagline", "aera-lockup-stacked", "aera-mark-mono-black"]) {
  pdfOf(readFileSync(join(SVG_DIR, `${name}.svg`), "utf8"), join(PDF_DIR, `${name}.pdf`));
}

const smallSvg = markSvg(V.small, { file: true });
const icoFile = ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, buf: await sharp(Buffer.from(smallSvg), { density: 72 * (size / 64) * 4 }).resize(size, size).png().toBuffer() }))));
writeFileSync(join(here, "logo", "favicon.ico"), icoFile);

// The app uses the same files
const PUB = join(root, "frontend", "public");
writeFileSync(join(PUB, "icon.svg"), markSvg(V.mark, { file: true }) + "\n");
writeFileSync(join(root, "frontend", "app", "favicon.ico"), icoFile);
await png(markSvg(V.mark, { file: true }), join(PUB, "icons", "icon-192.png"), 192);
await png(markSvg(V.mark, { file: true }), join(PUB, "icons", "icon-512.png"), 512);
await png(markSvg(V.maskable, { file: true }), join(PUB, "icons", "maskable-512.png"), 512);
await png(markSvg(V.square, { file: true }), join(PUB, "icons", "apple-touch-icon.png"), 180);

// Word report frame (A1 "Plain frame"), A4 in millimetres. The mark breaks the top-left corner and
// the bottom edge leaves a gap for the page-number pill, which the template draws as a Word shape.
const BORDER_DIR = join(here, "word", "border");
mkdirSync(BORDER_DIR, { recursive: true });
const frameSvg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297">` +
  `<path d="M26 10H195A5 5 0 0 1 200 15V282A5 5 0 0 1 195 287H115M95 287H15A5 5 0 0 1 10 282V23" fill="none" stroke="${C.navy}" stroke-width=".35" stroke-linecap="round"/>` +
  `<g transform="translate(11 9) scale(${12 / 64})">${markBody(V.mark)}</g></svg>\n`;
writeFileSync(join(BORDER_DIR, "aera-frame-a4.svg"), frameSvg);
await png(frameSvg, join(BORDER_DIR, "aera-frame-a4.png"), 2480);

// ---------------------------------------------------------------------------------------------
// Mockups
// ---------------------------------------------------------------------------------------------

const FONT_LINK = `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap">`;
const scene = (css, body) =>
  `<!doctype html><meta charset="utf-8">${FONT_LINK}<style>*{box-sizing:border-box}html,body{margin:0;height:100%}body{font-family:"Plus Jakarta Sans",system-ui,sans-serif;color:${C.ink};-webkit-font-smoothing:antialiased}${css}</style>${body}`;

const glyphs = [
  '<circle cx="12" cy="12" r="6" fill="none" stroke="#fff" stroke-width="2.4"/>',
  '<rect x="6" y="6" width="12" height="12" rx="3" fill="none" stroke="#fff" stroke-width="2.4"/>',
  '<path d="M6 16l4-5 3 3 5-7" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  '<path d="M7 7h10M7 12h10M7 17h6" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>',
  '<circle cx="12" cy="12" r="3" fill="#fff"/><circle cx="12" cy="12" r="7.5" fill="none" stroke="#fff" stroke-width="2"/>',
  '<path d="M12 5v14M5 12h14" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>',
];
const appIcon = (bg, i, label) =>
  `<div class="app"><div class="ic" style="background:${bg}"><svg viewBox="0 0 24 24" width="30" height="30">${glyphs[i % glyphs.length]}</svg></div><span>${label}</span></div>`;
const aeraIcon = (label = "AERA") => `<div class="app"><div class="ic aera">${markSvg(V.square, { width: 62 })}</div><span>${label}</span></div>`;

const crowdCars = (labels = true) =>
  `<div class="cars">${["Quiet", "Comfortable", "Busy", "Crowded"]
    .map((l, i) => `<div class="car" style="--c:${C.crowd[i]}"><i></i>${labels ? `<span>${l}</span>` : ""}</div>`)
    .join("")}</div>`;

const MOCKUPS = [
  {
    file: "01-app-icon-home-screen.png",
    title: "App icon on a phone home screen",
    w: 1200,
    h: 760,
    html: scene(
      `body{background:linear-gradient(135deg,#eaf1ff,#f4f6fb 60%);display:flex;align-items:center;justify-content:center;gap:90px}
      .phone{width:330px;height:680px;border-radius:52px;background:${C.ink};padding:12px;box-shadow:0 40px 80px rgba(10,49,128,.25)}
      .screen{height:100%;border-radius:42px;background:linear-gradient(160deg,#16306b,#2a6fd6 55%,#7cc8f7);padding:54px 22px 0;position:relative;overflow:hidden}
      .status{position:absolute;top:18px;left:34px;right:30px;display:flex;justify-content:space-between;color:#fff;font-weight:700;font-size:14px}
      .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:22px 0;justify-items:center}
      .app{display:grid;justify-items:center;gap:6px;color:#fff;font-size:11.5px;font-weight:500}
      .ic{width:62px;height:62px;border-radius:15px;display:flex;align-items:center;justify-content:center;overflow:hidden}
      .ic.aera{box-shadow:0 6px 16px rgba(0,0,0,.25)}
      .dock{position:absolute;left:14px;right:14px;bottom:14px;height:90px;border-radius:30px;background:rgba(255,255,255,.22);display:flex;justify-content:space-around;align-items:center}
      .dock .app span{display:none}
      .zoom{display:grid;gap:18px;justify-items:start;max-width:330px}
      .big{width:200px;height:200px;border-radius:45px;overflow:hidden;box-shadow:0 30px 60px rgba(10,49,128,.3)}
      h2{margin:0;font-size:28px;font-weight:800;letter-spacing:-.02em}p{margin:0;color:#475569;font-size:16px;line-height:1.5}
      code{font-family:"IBM Plex Mono",monospace;font-size:13px;background:#fff;padding:3px 8px;border-radius:6px}`,
      `<div class="phone"><div class="screen"><div class="status"><span>8:14</span><span>5G</span></div><div class="grid">
      ${appIcon("#10b981", 0, "Clock")}${appIcon("#f97316", 1, "Notes")}${appIcon("#6366f1", 2, "Stocks")}${appIcon("#0ea5e9", 3, "Mail")}
      ${appIcon("#e11d48", 4, "Music")}${aeraIcon()}${appIcon("#475569", 5, "Settings")}${appIcon("#14b8a6", 2, "Health")}
      ${appIcon("#f59e0b", 1, "Photos")}${appIcon("#8b5cf6", 0, "Podcasts")}${appIcon("#0f766e", 3, "Files")}${appIcon("#2563eb", 4, "Camera")}
      </div><div class="dock">${appIcon("#22c55e", 0, "")}${appIcon("#3b82f6", 3, "")}${aeraIcon("")}${appIcon("#64748b", 5, "")}</div></div></div>
      <div class="zoom"><div class="big">${markSvg(V.square, { width: 200 })}</div><h2>Home screen icon</h2><p>The square file is rounded by the phone itself. Installed from the browser, AERA sits beside the rider's other everyday apps.</p><code>aera-app-icon-ios-1024.png</code></div>`,
    ),
  },
  {
    file: "02-splash-and-app.png",
    title: "Splash screen and app bar",
    w: 1200,
    h: 800,
    html: scene(
      `body{background:#e9eef8;display:flex;align-items:center;justify-content:center;gap:70px}
      .phone{width:330px;height:690px;border-radius:52px;background:${C.ink};padding:12px;box-shadow:0 40px 80px rgba(10,49,128,.25)}
      .screen{height:100%;border-radius:42px;overflow:hidden;position:relative;background:#fff}
      .splash{background:radial-gradient(120% 80% at 30% 20%,${C.blue},${C.navy} 60%,#071f55);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0}
      .splash small{position:absolute;bottom:46px;color:#b9c7e4;font-size:12px;font-weight:500}
      .bar{display:flex;align-items:center;justify-content:space-between;padding:52px 18px 14px;border-bottom:1px solid #e6eaf2}
      .bar b{font-size:19px;font-weight:800;letter-spacing:-.02em;display:flex;align-items:center;gap:9px}
      .clock{font-size:12px;font-weight:600;background:#f4f6fb;border-radius:99px;padding:6px 11px;display:flex;gap:6px;align-items:center}
      .clock i{width:7px;height:7px;border-radius:9px;background:#10b981}
      .body{padding:18px;display:grid;gap:12px}
      .card{border-radius:16px;box-shadow:0 2px 10px rgba(14,23,38,.08);padding:14px 16px;display:grid;gap:8px}
      .card h4{margin:0;font-size:15px}.card p{margin:0;font-size:12.5px;color:#475569}
      .row{display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:600}
      .chip{font-size:11.5px;border-radius:99px;padding:3px 10px;font-weight:700}
      .cars{display:flex;gap:4px}.car{flex:1;display:grid;gap:4px}.car i{height:14px;border-radius:4px;background:var(--c)}.car span{font-size:9.5px;color:#475569;text-align:center}
      .tabs{position:absolute;bottom:0;left:0;right:0;height:78px;border-top:1px solid #e6eaf2;display:flex;justify-content:space-around;padding-top:12px;font-size:10.5px;font-weight:600;color:#64748b;background:#fff}
      .tabs span{display:grid;justify-items:center;gap:4px}.tabs span::before{content:"";width:20px;height:20px;border-radius:6px;background:#cfd6e3}
      .tabs .on{color:#2563eb}.tabs .on::before{background:#2563eb}`,
      `<div class="phone"><div class="screen splash">${lockupSvg("stacked", "#fff", SUB_DARK, { width: 210 })}<small>Live crowding on the Kelana Jaya Line</small></div></div>
      <div class="phone"><div class="screen"><div class="bar"><b>${markSvg(V.mark, { width: 30 })}AERA</b><span class="clock"><i></i>08:14</span></div>
      <div class="body"><div class="card"><h4>KL Sentral to KLCC</h4><p>Next train in 2 min · 4 stops · 9 min</p>${crowdCars()}<p>Board at the back: car 1 is quiet.</p></div>
      <div class="card"><div class="row">Gombak <span class="chip" style="background:#d1fae5;color:#065f46">Quiet</span></div><div class="row">Putra Heights <span class="chip" style="background:#ffedd5;color:#9a3412">Busy</span></div></div></div>
      <div class="tabs"><span class="on">Live</span><span>Network</span><span>Plan</span><span>Ask</span><span>You</span></div></div></div>`,
    ),
  },
  {
    file: "03-browser-tab.png",
    title: "Favicon and web app bar",
    w: 1200,
    h: 700,
    html: scene(
      `body{background:linear-gradient(180deg,#dfe6f3,#eef2f9);display:flex;align-items:center;justify-content:center}
      .win{width:1040px;height:580px;border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 30px 70px rgba(10,49,128,.22)}
      .tabs{height:44px;background:#e6eaf2;display:flex;align-items:flex-end;gap:2px;padding:0 12px}
      .dots{display:flex;gap:7px;align-self:center;margin-right:14px}.dots i{width:12px;height:12px;border-radius:9px;background:#cfd6e3}
      .tab{height:34px;border-radius:10px 10px 0 0;padding:0 14px;display:flex;align-items:center;gap:9px;font-size:13px;color:#475569;width:250px;white-space:nowrap;overflow:hidden}
      .tab.on{background:#fff;color:${C.ink};font-weight:600}
      .addr{height:42px;display:flex;align-items:center;padding:0 16px;border-bottom:1px solid #e6eaf2}
      .addr div{flex:1;height:30px;border-radius:99px;background:#f4f6fb;display:flex;align-items:center;padding:0 16px;font-size:13px;color:#475569}
      .bar{height:64px;display:flex;align-items:center;gap:28px;padding:0 28px;border-bottom:1px solid #e6eaf2}
      .bar nav{display:flex;gap:6px;font-size:14px;font-weight:600;color:#475569}.bar nav span{padding:7px 14px;border-radius:99px}.bar nav .on{background:#eaf1ff;color:#2563eb}
      main{padding:30px 28px;display:grid;gap:16px}h1{margin:0;font-size:28px;font-weight:800;letter-spacing:-.02em}
      .line{display:flex;align-items:center;gap:14px;padding:18px 20px;border-radius:16px;box-shadow:0 2px 10px rgba(14,23,38,.08);font-weight:600}
      .badge{background:${C.lineKJ};color:#fff;border-radius:8px;padding:4px 9px;font-size:13px;font-weight:800}
      .good{margin-left:auto;background:#d1fae5;color:#065f46;border-radius:99px;padding:5px 12px;font-size:13px}
      .zoomtab{position:absolute;left:150px;top:30px;padding:10px 16px;border-radius:12px;background:#fff;box-shadow:0 12px 30px rgba(10,49,128,.2);display:flex;align-items:center;gap:10px;font-weight:600;font-size:15px}`,
      `<div class="win"><div class="tabs"><span class="dots"><i></i><i></i><i></i></span><div class="tab on">${markSvg(V.small, { width: 16 })}AERA · Advanced Ecosystem of Rail…</div><div class="tab">New tab</div></div>
      <div class="addr"><div>localhost:3000/status</div></div>
      <div class="bar">${lockupSvg("horizontal", C.ink, null, { width: 116 })}<nav><span>Live</span><span>Network</span><span>Plan</span><span class="on">Status</span><span>Ask</span></nav></div>
      <main><h1>Service status</h1><div class="line"><span class="badge">KJ</span>Kelana Jaya Line<span class="good">Good service</span></div><div class="line"><span class="badge" style="background:#e57200">AG</span>Ampang Line<span class="good">Good service</span></div></main></div>
      <div class="zoomtab">${markSvg(V.small, { width: 32 })}Favicon at 16 px, shown here at 2×</div>`,
    ),
  },
  {
    file: "04-business-card.png",
    title: "Business card, front and back",
    w: 1200,
    h: 700,
    html: scene(
      `body{background:#dfe5ef;display:flex;align-items:center;justify-content:center;gap:56px}
      .card{width:440px;height:280px;border-radius:14px;box-shadow:0 24px 50px rgba(14,23,38,.25);position:relative;overflow:hidden}
      .front{background:radial-gradient(140% 120% at 0% 0%,${C.blue},${C.navy} 70%);display:flex;align-items:center;justify-content:center;transform:rotate(-4deg)}
      .front .lines{position:absolute;left:-20px;bottom:46px;display:grid;gap:10px}.front .lines i{display:block;height:6px;border-radius:6px;background:${C.sky}}
      .back{background:#fff;padding:34px 36px;display:grid;align-content:space-between;transform:rotate(3deg)}
      .back h3{margin:0;font-size:22px;font-weight:800;letter-spacing:-.02em}.back p{margin:4px 0 0;font-size:13px;color:#475569}
      .back .foot{display:flex;justify-content:space-between;align-items:flex-end;font-size:11.5px;color:#475569;line-height:1.6}
      .stripe{position:absolute;right:0;top:0;bottom:0;width:10px;background:linear-gradient(${C.blue},${C.navy})}`,
      `<div class="card front">${lockupSvg("tagline", "#fff", SUB_DARK, { width: 330 })}<div class="lines"><i style="width:90px;opacity:.7"></i><i style="width:130px;opacity:.4"></i></div></div>
      <div class="card back"><div><h3>Mahendra Tanjung</h3><p>AERA team · Group 2</p></div>
      <div class="foot"><span>Technopreneurship<br>Universiti Teknologi PETRONAS</span>${markSvg(V.mark, { width: 46 })}</div><span class="stripe"></span></div>`,
    ),
  },
  {
    file: "05-platform-poster.png",
    title: "Platform poster",
    w: 1200,
    h: 900,
    html: scene(
      `body{background:linear-gradient(180deg,#c9d1de,#b7c1d1);display:flex;align-items:center;justify-content:center}
      .frame{padding:16px;background:#2b3443;border-radius:6px;box-shadow:0 30px 60px rgba(0,0,0,.3)}
      .poster{width:500px;height:707px;background:radial-gradient(120% 70% at 20% 10%,${C.blue},${C.navy} 65%,#071f55);color:#fff;padding:44px 42px;display:grid;grid-template-rows:auto 1fr auto;position:relative;overflow:hidden}
      h1{margin:0;font-size:58px;line-height:1;font-weight:800;letter-spacing:-.035em;text-wrap:balance}
      p{margin:16px 0 0;font-size:17px;line-height:1.45;color:#dbe6fb;max-width:340px}
      .mid{align-self:center;display:grid;gap:14px}
      .train{display:flex;gap:6px;align-items:flex-end}.cars{display:flex;gap:6px;flex:1}.car{flex:1;display:grid;gap:8px}.car i{height:46px;border-radius:9px;background:var(--c)}.car:last-child i{border-top-right-radius:30px}
      .car span{font-size:12.5px;font-weight:700;color:#fff;text-align:center}
      .foot{display:flex;justify-content:space-between;align-items:flex-end}
      .foot small{font-size:13px;color:#b9c7e4;font-weight:600;text-align:right;line-height:1.5}
      .speed{position:absolute;left:0;top:300px;display:grid;gap:12px}.speed i{display:block;height:8px;border-radius:8px;background:${C.sky}}`,
      `<div class="frame"><div class="poster"><div><h1>Board the quieter car.</h1><p>AERA predicts how full every car will be on the Kelana Jaya Line, before the train arrives.</p></div>
      <div class="mid">${crowdCars()}</div>
      <div class="foot">${lockupSvg("horizontal", "#fff", null, { width: 160 })}<small>Open AERA on your phone<br>Kelana Jaya Line · 37 stations</small></div></div></div>`,
    ),
  },
  {
    file: "06-presentation-title.png",
    title: "Presentation title slide",
    w: 1280,
    h: 720,
    html: scene(
      `body{background:#fff;position:relative;overflow:hidden}
      .wrap{position:absolute;inset:0;padding:70px 80px;display:grid;grid-template-rows:auto 1fr auto}
      h1{margin:0;font-size:60px;line-height:1.04;font-weight:800;letter-spacing:-.035em;max-width:700px;text-wrap:balance}
      .mid{align-self:center;display:grid;gap:22px}
      p{margin:0;font-size:22px;color:#475569;max-width:640px;line-height:1.45}
      .meta{display:flex;gap:28px;font-size:15px;font-weight:600;color:#475569}
      .band{position:absolute;right:0;top:0;bottom:0;width:380px;background:radial-gradient(120% 90% at 30% 20%,${C.blue},${C.navy} 70%);display:flex;align-items:center;justify-content:center}
      .band .speed{position:absolute;left:-60px;top:330px;display:grid;gap:16px}.band .speed i{display:block;height:12px;border-radius:12px;background:${C.sky}}`,
      `<div class="band">${markSvg(V.onDark, { width: 250 })}</div>
      <div class="wrap">${lockupSvg("tagline", C.ink, SUB, { width: 300 })}<div class="mid"><h1>Know how full the train is before it arrives</h1><p>A digital twin of the LRT Kelana Jaya Line that predicts crowding inside every car.</p></div>
      <div class="meta"><span>Group 2</span><span>UTP Technopreneurship</span><span>October 2026</span></div></div>`,
    ),
  },
  {
    file: "07-staff-badge.png",
    title: "Operator staff badge",
    w: 1200,
    h: 800,
    html: scene(
      `body{background:linear-gradient(180deg,#eef2f9,#dfe6f3);display:flex;align-items:flex-start;justify-content:center;gap:120px;padding-top:0}
      .lan{display:grid;justify-items:center}
      .strap{width:44px;height:200px;background:${C.ops};display:grid;justify-items:center;align-content:space-around;padding:10px 0}
      .clip{width:60px;height:34px;border-radius:8px;background:#94a3b8;margin-top:-4px}
      .badge{width:300px;height:450px;border-radius:20px;background:#fff;box-shadow:0 30px 60px rgba(11,31,68,.28);overflow:hidden;margin-top:14px;display:grid;grid-template-rows:150px 1fr}
      .top{background:${C.ops};display:flex;align-items:center;justify-content:center;position:relative}
      .chip{position:absolute;right:16px;top:16px;background:${C.sky};color:${C.ops};font-size:11px;font-weight:800;letter-spacing:.12em;border-radius:99px;padding:5px 11px}
      .info{padding:0 26px 26px;display:grid;justify-items:center;align-content:start;text-align:center}
      .photo{width:110px;height:110px;border-radius:99px;background:#e6eaf2;border:6px solid #fff;margin-top:-55px;display:flex;align-items:flex-end;justify-content:center;overflow:hidden}
      .photo i{width:64px;height:64px;border-radius:99px 99px 0 0;background:#cfd6e3;display:block}
      h3{margin:14px 0 4px;font-size:22px;font-weight:800;letter-spacing:-.02em}.info p{margin:0;color:#475569;font-size:14px}
      .line{margin-top:18px;display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600}.line b{background:${C.lineKJ};color:#fff;border-radius:6px;padding:2px 7px;font-size:12px}
      .bars{margin-top:22px;height:34px;width:200px;background:repeating-linear-gradient(90deg,${C.ink} 0 2px,transparent 2px 5px,${C.ink} 5px 6px,transparent 6px 9px)}`,
      `<div class="lan"><div class="strap">${[0, 1, 2].map(() => markSvg(V.onDark, { width: 30 })).join("")}</div><div class="clip"></div>
      <div class="badge"><div class="top">${lockupSvg("horizontal", "#fff", null, { width: 170 })}<span class="chip">OPERATOR</span></div>
      <div class="info"><div class="photo"><i></i></div><h3>Duty controller</h3><p>Line control room</p><div class="line"><b>KJ</b>Kelana Jaya Line</div><div class="bars"></div></div></div></div>`,
    ),
  },
  {
    file: "08-social-profile.png",
    title: "Social media profile",
    w: 1200,
    h: 760,
    html: scene(
      `body{background:#eef2f9;display:flex;align-items:center;justify-content:center}
      .prof{width:900px;border-radius:20px;background:#fff;box-shadow:0 30px 60px rgba(10,49,128,.18);overflow:hidden}
      .cover{height:250px;background:radial-gradient(120% 140% at 20% 0%,${C.blue},${C.navy} 70%);position:relative;overflow:hidden}
      .cover svg.t{position:absolute;right:-40px;top:20px;opacity:.95}
      .body{padding:0 36px 34px;position:relative}
      .avatar{width:150px;height:150px;border-radius:99px;overflow:hidden;border:6px solid #fff;margin-top:-75px;box-shadow:0 10px 24px rgba(10,49,128,.2)}
      .follow{position:absolute;right:36px;top:20px;background:${C.ink};color:#fff;border-radius:99px;padding:10px 22px;font-weight:700;font-size:15px}
      h2{margin:14px 0 2px;font-size:28px;font-weight:800;letter-spacing:-.02em}.sub{color:#475569;font-size:15px;margin:0}
      .bio{margin:14px 0 0;font-size:16px;line-height:1.5;max-width:620px}
      .posts{margin-top:22px;display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
      .post{height:150px;border-radius:14px;display:flex;align-items:center;justify-content:center;overflow:hidden}`,
      `<div class="prof"><div class="cover"><svg class="t" viewBox="2 26 56 16" width="720" height="206"><g>${G.speed.map((s) => `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="2" rx="1" fill="${C.sky}" opacity="${s.op}"/>`).join("")}<path d="${G.train}${G.cab}${G.side}" fill-rule="evenodd" fill="${C.sky}"/></g></svg></div>
      <div class="body"><div class="avatar">${markSvg(V.maskable, { width: 150 })}</div><span class="follow">Follow</span>
      <h2>AERA</h2><p class="sub">Advanced Ecosystem of Rail Analytics</p>
      <p class="bio">Live crowding inside every Kelana Jaya Line train, car by car. A UTP Technopreneurship project, Group 2.</p>
      <div class="posts"><div class="post" style="background:#eaf1ff">${markSvg(V.onLight, { width: 120 })}</div><div class="post" style="background:${C.navy}">${markSvg(V.onDark, { width: 120 })}</div><div class="post" style="background:#f4f6fb">${lockupSvg("stacked", C.ink, SUB, { width: 120 })}</div></div></div></div>`,
    ),
  },
];

for (const m of MOCKUPS) screenshot(m.html, join(MOCK_DIR, m.file), m.w, m.h);

// ---------------------------------------------------------------------------------------------
// Guideline PDF
// ---------------------------------------------------------------------------------------------

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const cmyk = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const k = 1 - Math.max(r, g, b);
  if (k === 1) return [0, 0, 0, 100];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k].map((v) => Math.round(v * 100));
};
const lum = (hex) =>
  rgb(hex)
    .map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return ((x + 0.05) / (y + 0.05)).toFixed(1);
};

const rel = (p) => relative(GUIDE_DIR, p).split("\\").join("/");
const mock = (f) => rel(join(MOCK_DIR, f));
const APP_SHOTS = [
  ["app-desktop-status.png", "Service status page at 1440 px: the Express mark and wordmark in the app bar."],
  ["app-phone-status.png", "Service status and the welcome flow on a 390 px phone."],
].filter(([f]) => existsSync(join(MOCK_DIR, f)));

const cross = `<svg class="x" viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="11" fill="#dc2626"/><path d="M8 8l8 8M16 8l-8 8" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>`;

const COLOURS = [
  ["AERA Blue", C.blue, "Top of the tile gradient. Primary brand colour."],
  ["AERA Navy", C.navy, "Bottom of the tile gradient; the A on light backgrounds."],
  ["Rail Sky", C.sky, "The train on the tile and on dark backgrounds."],
  ["Rail Sky Deep", C.skyDeep, "The train on white, where Rail Sky is too light."],
  ["Ink", C.ink, "Wordmark and text on light backgrounds."],
  ["Signal Orange", C.orange, "Accent for highlights in the app. Never inside the logo."],
];

const MISUSE = [
  [`<svg viewBox="0 0 64 64" width="150" height="80" preserveAspectRatio="none">${markBody(V.mark)}</svg>`, "Do not stretch or squash it."],
  [markSvg({ ...V.mark, tileColors: [C.lineKJ, "#8f0021"] }, { width: 84 }), "Do not recolour the tile. Line red belongs to the Kelana Jaya Line."],
  [markSvg({ ...V.mark, trainColor: C.crowd[3] }, { width: 84 }), "Do not colour the train with crowding colours; they carry data."],
  [`<svg viewBox="0 0 64 64" width="84" height="84"><g transform="rotate(-18 32 32)">${markBody(V.mark)}</g></svg>`, "Do not rotate or tilt it."],
  [`<div class="busy">${markSvg(V.onDark, { width: 90 })}</div>`, "Do not put the untiled mark on busy images. Use the tile."],
  [markSvg({ ...V.mark, outline: true }, { width: 84 }), "Do not draw it in outline."],
  [`<span class="retype">${markSvg(V.mark, { width: 54 })}<b>Aera</b></span>`, "Do not retype the wordmark or change its font."],
  [`<span class="glow">${markSvg(V.mark, { width: 84 })}</span>`, "Do not add glows, bevels or heavy effects."],
];

const gridLines = (() => {
  let s = "";
  for (let i = 0; i <= 64; i += 4) {
    const major = i % 16 === 0;
    const st = `stroke="#ffffff" stroke-opacity="${major ? 0.35 : 0.13}" stroke-width="${major ? 0.18 : 0.1}"`;
    s += `<path d="M${i} 0V64M0 ${i}H64" ${st}/>`;
  }
  return s;
})();
const dim = (x1, y1, x2, y2, label, lx, ly, anchor = "middle") =>
  `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${C.orange}" stroke-width=".35"/><text x="${lx}" y="${ly}" text-anchor="${anchor}" class="dl">${label}</text>`;
const construction = `<svg viewBox="-16 -9 100 82" class="construct">
  ${markBody(V.mark)}${gridLines}
  <path d="${G.a}" fill="none" stroke="${C.orange}" stroke-width=".3" stroke-dasharray="1 .8"/>
  <path d="${G.train}" fill="none" stroke="${C.orange}" stroke-width=".3" stroke-dasharray="1 .8"/>
  ${dim(0, -4, 64, -4, "64 units", 32, -5.6)}
  ${dim(-4, 0, -4, 64, "64", -5.4, 33, "end")}
  ${dim(24, 12.5, 31, 12.5, "m = 7", 27.5, 11.2).replace('class="dl"', 'class="dl w"')}
  ${dim(68, 31, 68, 38, "train m = 7", 69.4, 35.6, "start")}
  ${dim(66, 15, 66, 48, "", 0, 0)}<text x="69.4" y="23" class="dl">A height 33</text><text x="69.4" y="26.6" class="dl">apex at 15</text><text x="69.4" y="46" class="dl">feet at 48</text>
  ${dim(36, 50.5, 43, 50.5, "leg m = 7", 39.5, 54.2).replace('class="dl"', 'class="dl w"')}
  ${dim(41, 40.5, 56, 40.5, "nose 15", 56, 44, "end").replace('class="dl"', 'class="dl w"')}
  <path d="M0 16A16 16 0 0 1 16 0" fill="none" stroke="${C.orange}" stroke-width=".5"/><text x="5" y="11" class="dl w">r 16</text>
  <text x="5" y="28.6" class="dl w">speed lines 2</text>
</svg>`;

const clearSpace = `<svg viewBox="-24 -24 112 112" class="clear">
  <rect x="-16" y="-16" width="96" height="96" fill="none" stroke="${C.orange}" stroke-width=".5" stroke-dasharray="2 1.4"/>
  <rect x="-16" y="-16" width="16" height="16" fill="${C.orange}" fill-opacity=".14"/><text x="-8" y="-6" text-anchor="middle" class="dl" style="font-size:5px">x</text>
  ${markBody(V.mark)}
  <text x="32" y="-19" text-anchor="middle" class="dl" style="font-size:4.6px">x = 16 units = a quarter of the tile</text>
</svg>`;

const P = [];
const page = (title, body, cls = "") => P.push({ title, body, cls });

page(
  "Cover",
  `<div class="cover-in"><div>${markSvg(V.onDark, { width: 360 })}</div><div class="cover-text"><p class="eyebrow light">Brand guideline</p><h1>AERA</h1><p class="big">Advanced Ecosystem of Rail Analytics</p><p class="meta">Version ${VERSION}</p></div></div>`,
  "dark cover",
);

page(
  "Contents",
  `<div class="two"><div><p class="eyebrow">About this guideline</p><h2>One mark, used the same way everywhere</h2>
  <p>This guideline sets out the AERA logo and how to use it: the mark and what it means, its construction, versions and lockups, colour and type. Follow it for the app, reports, slides, posters and anything printed.</p></div>
  <ol class="toc">__TOC__</ol></div>`,
);

page(
  "AERA and its name",
  `<div class="two"><div><p class="eyebrow">What AERA is</p><h2>A digital twin of the Kelana Jaya Line</h2>
  <p>AERA is a digital twin of the LRT Kelana Jaya Line in Kuala Lumpur. It runs every train on the published timetable at real time and predicts how crowded each train, and each car, will be, using ridership data from data.gov.my. Riders use it to choose a quieter train or car; control-room staff use it to see where the line is under pressure.</p>
  <p>The logo has to work for both groups: friendly enough for a rider's home screen and serious enough for an operator's console.</p></div>
  <div><p class="eyebrow">The name</p><div class="word">AERA</div><p class="spell"><b>A</b>dvanced <b>E</b>cosystem of <b>R</b>ail <b>A</b>nalytics</p>
  <p>The word is older than the acronym. In Latin, <em>aera</em> is the plural of <em>aes</em>, bronze: the bronze counters used to keep accounts. Late Latin used <em>aera</em> for the fixed point from which years were counted, which gave English the word <em>era</em>.</p>
  <p>AERA counts riders car by car and marks the moment a train gets busy, so the name already carries the product's story.</p></div></div>
  <div class="facts">${[["37", "stations on the Kelana Jaya Line"], ["4", "cars per Innovia Metro 300 train"], ["800", "riders per train at full capacity"], ["5", "crowding levels, from Quiet to Packed"]].map(([n, l]) => `<div><b>${n}</b><span>${l}</span></div>`).join("")}</div>`,
);

page(
  "The mark",
  `<div class="two"><div class="center"><svg viewBox="-2 -2 68 68" width="380" height="380">${markBody(V.mark)}
    ${[
      [27.5, 15, 27.5, 7.5, 1],
      [55, 37, 57, 47, 2],
      [46, 33.6, 47, 24.5, 3],
      [9, 32, 8, 23.5, 4],
      [8.5, 55.5, 8.5, 55.5, 5],
    ]
      .map(([x1, y1, x2, y2, n]) => `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="#fff" stroke-width=".35"/><circle cx="${x2}" cy="${y2}" r="2.7" fill="#fff"/><text x="${x2}" y="${y2 + 1.15}" text-anchor="middle" class="callout">${n}</text>`)
      .join("")}
  </svg></div>
  <div><p class="eyebrow">What it means</p><h2>The train runs through the A</h2><ol class="callouts">
  <li><b>The A</b> is for AERA. It is drawn, not typed: a flat top and straight legs, all one width, so it stays solid at 16 px.</li>
  <li><b>The train</b> sits where the A's crossbar would be. The train is what holds AERA together. It points right, forwards: AERA looks ahead and forecasts.</li>
  <li><b>The windows</b>, a cab window in the nose and a side window between the legs, make it read as a train and not a bar.</li>
  <li><b>The speed lines</b> say real time: the twin moves with the timetable at Kuala Lumpur time.</li>
  <li><b>The navy tile</b> stands for trust and operations. Its 16-unit corners match the cards in the app and the shape of a phone icon.</li></ol></div></div>`,
);

page(
  "Construction",
  `<div class="two wide-left"><div class="center">${construction}</div>
  <div><p class="eyebrow">Construction</p><h2>Drawn on a 64-unit grid</h2><ul class="spec">
  <li><b>One module, m = 7 units,</b> sets the apex width, the width of each leg and the height of the train.</li>
  <li><b>The A</b> is 33 units tall, from the apex at 15 to the feet at 48. Its legs lean 12 units across in 33 units up (about 70°).</li>
  <li><b>The train</b> runs from 31 to 38 and its nose ends at 56, 8 units from the tile's edge. The nose curve is 15 units long.</li>
  <li><b>The speed lines</b> are 2 units tall with 2 units between them, at 70% and 40% opacity on the tile.</li>
  <li><b>The tile</b> is 64 units square with 16-unit corners and runs from AERA Blue at the top left to AERA Navy at the bottom right.</li>
  <li><b>Below 24 px</b>, use the small version: no speed lines and no side window, shifted 2 units left to rebalance.</li></ul></div></div>`,
);

page(
  "Clear space and minimum size",
  `<div class="two"><div><p class="eyebrow">Clear space</p><h2>Give it room</h2><div class="center">${clearSpace}</div>
  <p>Keep a clear space of <b>x</b> on every side, where x is a quarter of the tile's width (16 units, the same as the corner radius). No text, edge or other logo enters it. Lockups use the same x, measured from the tile.</p></div>
  <div><p class="eyebrow">Minimum size</p><h2>Never smaller than this</h2>
  <div class="sizes">${[16, 24, 32, 48].map((s) => `<figure>${markSvg(s < 32 ? V.small : V.mark, { width: s })}<figcaption>${s} px${s < 32 ? "<br>small" : ""}</figcaption></figure>`).join("")}</div>
  <table class="tbl"><tbody>
  <tr><td>Mark, screen</td><td>16 px minimum. Use <code>aera-mark-small</code> up to 24 px.</td></tr>
  <tr><td>Mark, print</td><td>8 mm minimum.</td></tr>
  <tr><td>Horizontal lockup</td><td>96 px or 25 mm wide.</td></tr>
  <tr><td>Tagline lockup</td><td>180 px or 45 mm wide, so the full name stays readable.</td></tr></tbody></table></div></div>`,
);

page(
  "Logo versions",
  `<p class="eyebrow">Versions</p><h2>Pick the version for the background</h2>
  <div class="versions">
  ${[
    [markSvg(V.mark, { width: 92 }), "light", "Primary", "aera-mark"],
    [markSvg(V.small, { width: 92 }), "light", "Small, 24 px and below", "aera-mark-small"],
    [markSvg(V.onLight, { width: 120 }), "light", "On light", "aera-mark-on-light"],
    [markSvg(V.onDark, { width: 120 }), "navy", "On dark", "aera-mark-on-dark"],
    [markSvg(V.monoBlack, { width: 120 }), "light", "One colour, black", "aera-mark-mono-black"],
    [markSvg(V.monoWhite, { width: 120 }), "photo", "One colour, white", "aera-mark-mono-white"],
    [`<span class="circle">${markSvg(V.maskable, { width: 92 })}</span>`, "light", "Maskable (Android)", "aera-mark-maskable"],
    [`<span class="ios">${markSvg(V.square, { width: 92 })}</span>`, "light", "Phone icon (iOS)", "aera-app-icon-ios-1024.png"],
  ]
    .map(([art, bg, name, file]) => `<figure><div class="sw ${bg}">${art}</div><figcaption><b>${name}</b><code>${file}</code></figcaption></figure>`)
    .join("")}</div>`,
);

page(
  "Lockups",
  `<p class="eyebrow">Lockups</p><h2>The mark with its name</h2>
  <p class="lead">The wordmark is AERA in Plus Jakarta Sans ExtraBold, outlined, with tracking tightened by 1%. In the horizontal lockup its capitals are as tall as the A in the mark and sit on the same baseline, with a gap of x between them. On navy and dark backgrounds the reverse lockups drop the tile, which would disappear into the background.</p>
  <div class="lockups">
  ${[
    [lockupSvg("horizontal", C.ink, null, { width: 230 }), "light", "Horizontal (default)", "aera-lockup-horizontal"],
    [lockupSvg("horizontal", "#fff", null, { width: 230 }), "navy", "Horizontal, reverse", "aera-lockup-horizontal-reverse"],
    [lockupSvg("tagline", C.ink, SUB, { width: 300 }), "light", "With the full name", "aera-lockup-tagline"],
    [lockupSvg("stacked", C.ink, SUB, { width: 150 }), "light", "Stacked", "aera-lockup-stacked"],
    [lockupSvg("stacked", "#fff", SUB_DARK, { width: 150 }), "navy", "Stacked, reverse", "aera-lockup-stacked-reverse"],
    [lockupSvg("mono", "#000000", null, { width: 220 }), "light", "One colour", "aera-lockup-mono-black"],
  ]
    .map(([art, bg, name, file]) => `<figure><div class="sw ${bg}">${art}</div><figcaption><b>${name}</b><code>${file}</code></figcaption></figure>`)
    .join("")}</div>`,
);

page(
  "Colour",
  `<p class="eyebrow">Colour</p><h2>Navy, blue and the light blue of the train</h2>
  <div class="swatches">${COLOURS.map(
    ([name, hex, use]) => `<div class="swatch"><i style="background:${hex}"></i><b>${name}</b><dl>
    <dt>HEX</dt><dd>${hex.toUpperCase()}</dd><dt>RGB</dt><dd>${rgb(hex).join(" ")}</dd><dt>CMYK</dt><dd>${cmyk(hex).join(" ")}</dd></dl><p>${use}</p></div>`,
  ).join("")}</div>
  <div class="two"><table class="tbl"><thead><tr><th>Pair</th><th>Contrast</th></tr></thead><tbody>
  ${[
    ["White on AERA Navy", C.white, C.navy],
    ["White on AERA Blue", C.white, C.blue],
    ["Rail Sky on AERA Navy", C.sky, C.navy],
    ["Rail Sky Deep on white", C.skyDeep, C.white],
    ["Ink on white", C.ink, C.white],
  ]
    .map(([l, a, b]) => `<tr><td>${l}</td><td class="num">${contrast(a, b)} : 1</td></tr>`)
    .join("")}</tbody></table>
  <p class="note">CMYK values are converted directly from RGB; ask the printer for a proof before a print run. Crowding colours (green to red) and line colours belong to the app's data and are never used in the logo.</p></div>`,
);

page(
  "Typography",
  `<div class="two"><div><p class="eyebrow">Typeface</p><div class="aa">Aa</div><h2>Plus Jakarta Sans</h2>
  <p>Designed by Gumpita Rahayu (Tokotype) for the +Jakarta city identity, and free under the SIL Open Font License. It is a modern geometric sans from the region, clear on small phone screens. AERA uses it for the wordmark, the app and every document.</p><p class="glyphs">ABCDEFGHIJKLMNOPQRSTUVWXYZ<br>abcdefghijklmnopqrstuvwxyz<br>0123456789 · : % → ×</p></div>
  <div class="type"><div><span>ExtraBold 800</span><p style="font-weight:800;font-size:28pt;letter-spacing:-.02em">Board the quieter car</p></div>
  <div><span>Bold 700</span><p style="font-weight:700;font-size:17pt">Kelana Jaya Line, 37 stations</p></div>
  <div><span>SemiBold 600, capitals tracked +8%</span><p style="font-weight:600;font-size:10pt;letter-spacing:.08em;text-transform:uppercase">Next train · Gombak</p></div>
  <div><span>Regular 400</span><p style="font-size:11pt;line-height:1.5">AERA predicts how full every car will be, so riders can choose a quieter train before it arrives.</p></div>
  <div><span>Tabular figures for times</span><p class="tab" style="font-weight:700;font-size:20pt">08:14 · 08:17 · 08:21</p></div></div></div>`,
);

page(
  "Misuse",
  `<p class="eyebrow">Misuse</p><h2>Do not change the mark</h2>
  <div class="misuse">${MISUSE.map(([art, text]) => `<figure><div class="sw light">${art}${cross}</div><figcaption>${text}</figcaption></figure>`).join("")}</div>`,
);

const appPage = (items) =>
  `<div class="apps">${items.map((m) => `<figure><img src="${mock(m.file)}" alt="${m.title}"><figcaption>${m.title}</figcaption></figure>`).join("")}</div>`;
page("Applications", `<p class="eyebrow">Applications</p><h2>On screen</h2>${appPage(MOCKUPS.slice(0, 3).concat(MOCKUPS[7]))}`);
page("Applications in print", `<p class="eyebrow">Applications</p><h2>In print and in person</h2>${appPage(MOCKUPS.slice(3, 7))}`);
if (APP_SHOTS.length) {
  page(
    "In the app",
    `<p class="eyebrow">Implementation</p><h2>Express in the live app</h2><div class="shots">${APP_SHOTS.map(([f, cap]) => `<figure><img src="${mock(f)}" alt=""><figcaption>${cap}</figcaption></figure>`).join("")}</div>
    <p class="note">The app draws the mark in code (<code>LogoMark</code> in <code>frontend/components/TopBar.tsx</code>, colours from <code>--brand-*</code> in <code>theme.css</code>) and uses the generated <code>icon.svg</code>, <code>favicon.ico</code> and phone icons.</p>`,
  );
}

const toc = P.slice(2)
  .map((p, i) => `<li><span>${p.title}</span><span class="num">${i + 3}</span></li>`)
  .join("");
P[1].body = P[1].body.replace("__TOC__", toc);

const guideline = `<!doctype html><html lang="en"><meta charset="utf-8"><title>AERA Brand Guideline</title>${FONT_LINK}<style>
@page { size: 297mm 210mm; margin: 0 }
* { box-sizing: border-box }
html, body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact }
body { font-family: "Plus Jakarta Sans", system-ui, sans-serif; color: ${C.ink}; font-size: 10.5pt; line-height: 1.5 }
.page { width: 297mm; height: 210mm; padding: 16mm 18mm 18mm; position: relative; overflow: hidden; break-after: page; background: #fff }
.page:last-child { break-after: auto }
.foot { position: absolute; left: 18mm; right: 18mm; bottom: 8mm; display: flex; justify-content: space-between; font-size: 8pt; color: #64748b; border-top: 1px solid #e6eaf2; padding-top: 3mm }
h1, h2, h3 { margin: 0; letter-spacing: -.02em; text-wrap: balance }
h2 { font-size: 24pt; font-weight: 800; line-height: 1.1; margin-bottom: 6mm }
h3 { font-size: 12.5pt; font-weight: 700; margin-bottom: 2mm }
p { margin: 0 0 3mm; max-width: 135mm }
.eyebrow { font-size: 8pt; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: ${C.skyDeep}; margin-bottom: 2.5mm }
.eyebrow.light { color: ${C.sky} }
code { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: .86em; background: #f4f6fb; padding: .2mm 1.4mm; border-radius: 1.2mm }
.note { font-size: 9pt; color: #475569 }
.lead { max-width: 200mm; color: #475569 }
.num, .tab { font-variant-numeric: tabular-nums }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 14mm; align-items: start }
.two.wide-left { grid-template-columns: 1.25fr 1fr }
.center { display: flex; justify-content: center; align-items: center }
.dark { background: radial-gradient(130% 120% at 15% 10%, ${C.blue}, ${C.navy} 60%, #071f55); color: #fff }
.dark .foot { color: #b9c7e4; border-color: rgba(255,255,255,.18) }
.cover-in { height: 100%; display: grid; grid-template-columns: auto 1fr; gap: 20mm; align-items: center; padding-left: 6mm }
.cover h1 { font-size: 72pt; font-weight: 800; letter-spacing: -.04em; line-height: 1 }
.cover .big { font-size: 17pt; font-weight: 600; color: #dbe6fb; margin-top: 3mm }
.cover .meta { margin-top: 14mm; color: #b9c7e4; font-size: 10.5pt }
.toc { list-style: none; margin: 0; padding: 0; display: grid; gap: 0 }
.toc li { display: flex; justify-content: space-between; padding: 2.3mm 0; border-bottom: 1px solid #e6eaf2; font-weight: 600 }
.toc .num { color: #64748b }
.word { font-size: 54pt; font-weight: 800; letter-spacing: -.04em; line-height: 1; color: ${C.blue} }
.spell { font-size: 12pt; color: #475569; margin: 2mm 0 5mm } .spell b { color: ${C.ink} }
.tbl { width: 100%; border-collapse: collapse; font-size: 9pt }
.tbl th { text-align: left; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .08em; color: #64748b; padding: 1.6mm 2mm; border-bottom: 1px solid #cfd6e3 }
.tbl td { padding: 1.8mm 2mm; border-bottom: 1px solid #e6eaf2; vertical-align: top }
.tbl tr.pick td { background: #eaf1ff; font-weight: 600 }
.spec { margin: 0; padding-left: 4.5mm; display: grid; gap: 2.6mm } .spec li { max-width: 120mm }
.callouts { margin: 0; padding-left: 5mm; display: grid; gap: 3mm } .callouts li { padding-left: 1mm }
.callout { font: 800 3.1px "Plus Jakarta Sans", sans-serif; fill: ${C.navy} }
.construct { width: 150mm; height: auto }
.dl { font: 600 2.6px "Plus Jakarta Sans", sans-serif; fill: ${C.ink} } .dl.w { fill: #fff }
.clear { width: 78mm; height: auto }
.sizes { display: flex; gap: 10mm; align-items: flex-end; margin-bottom: 6mm } .sizes figure { margin: 0; display: grid; gap: 2mm; justify-items: center; font-size: 8pt; color: #475569; text-align: center }
figure { margin: 0 }
.sw { height: 40mm; border-radius: 3mm; display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden }
.sw.light { background: #f4f6fb } .sw.navy { background: ${C.ops} }
.sw.photo { background: linear-gradient(135deg, #3b2f2a, #6b5b4b 40%, #1f2a37) }
figcaption { font-size: 8.5pt; margin-top: 2mm; display: grid; gap: .6mm } figcaption code { font-size: 7.5pt; justify-self: start }
.versions { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6mm 6mm }
.lockups { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm }
.lockups .sw { height: 44mm }
.circle { width: 92px; height: 92px; border-radius: 99px; overflow: hidden; display: block }
.ios { width: 92px; height: 92px; border-radius: 21px; overflow: hidden; display: block }
.swatches { display: grid; grid-template-columns: repeat(6, 1fr); gap: 5mm; margin-bottom: 6mm }
.swatch { display: grid; gap: 1.5mm; align-content: start } .swatch i { height: 24mm; border-radius: 3mm; display: block; border: 1px solid #e6eaf2 }
.swatch b { font-size: 10pt } .swatch p { font-size: 8pt; color: #475569 }
.swatch dl { display: grid; grid-template-columns: auto 1fr; gap: .3mm 2mm; margin: 0; font-family: "IBM Plex Mono", monospace; font-size: 7.5pt }
.swatch dt { color: #64748b } .swatch dd { margin: 0 }
.aa { font-size: 90pt; font-weight: 800; letter-spacing: -.04em; line-height: 1; color: ${C.blue}; margin-bottom: 3mm }
.type { display: grid; gap: 4.5mm } .type span { font-size: 7.5pt; color: #64748b; text-transform: uppercase; letter-spacing: .08em; font-weight: 600 } .type p { margin: .6mm 0 0; max-width: none }
.misuse { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6mm } .misuse .sw { height: 42mm } .misuse figcaption { font-size: 8.5pt }
.x { position: absolute; right: 3mm; top: 3mm }
.busy { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: repeating-linear-gradient(45deg, #f97316 0 8px, #fde68a 8px 16px, #38bdf8 16px 24px, #f4f6fb 24px 32px) }
.retype { display: flex; align-items: center; gap: 8px } .retype b { font-family: Georgia, "Times New Roman", serif; font-size: 30px; font-weight: 400 }
.glow svg { filter: drop-shadow(0 0 6px #f97316) drop-shadow(0 0 14px #38bdf8) }
.apps { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm 8mm } .apps img { width: 100%; height: 62mm; object-fit: contain; background: #eef2f9; border-radius: 3mm; display: block }
.shots { display: grid; grid-template-columns: 1.45fr 1fr; gap: 8mm; align-items: start; margin-bottom: 4mm } .shots img { width: 100%; max-height: 112mm; object-fit: contain; object-position: top left; border-radius: 3mm; border: 1px solid #e6eaf2; display: block }
.files td:first-child { white-space: nowrap } .files td { padding: .9mm 2mm; font-size: 8pt; line-height: 1.35 } .tbl td:first-child { white-space: nowrap }
.facts { position: absolute; left: 18mm; right: 18mm; bottom: 20mm; display: grid; grid-template-columns: repeat(4, 1fr); gap: 6mm; padding-top: 6mm; border-top: 1px solid #e6eaf2 }
.facts b { display: block; font-size: 34pt; font-weight: 800; letter-spacing: -.03em; color: #1149b8; line-height: 1.1 } .facts span { font-size: 9.5pt; color: #475569 }
.glyphs { margin-top: 8mm; font-size: 15pt; font-weight: 600; line-height: 1.45; color: #475569; letter-spacing: .02em }
</style><body>
${P.map((p, i) => `<section class="page ${p.cls}">${p.body}${i ? `<div class="foot"><span>AERA Brand Guideline</span><span>Page ${i + 1}</span></div>` : ""}</section>`).join("\n")}
</body></html>`;

writeFileSync(join(GUIDE_DIR, "guideline.html"), guideline);
chrome([`--print-to-pdf=${join(GUIDE_DIR, "AERA_Brand_Guideline.pdf")}`, pathToFileURL(join(GUIDE_DIR, "guideline.html")).href]);

console.log(`Built ${FILES.length} logo files, ${MOCKUPS.length} mockups and a ${P.length}-page guideline in ${relative(root, here)}/`);
