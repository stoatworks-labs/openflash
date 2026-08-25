#!/usr/bin/env node
// Capture the README screenshots from the running dev server.
//
// Deep links do the setup, so the shots are reproducible: no clicking, and the
// same command produces the same images after a UI change.
//
//   npm run dev            # in another terminal
//   node scripts/screenshot.mjs

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "screenshots");
const BASE = process.env.OPENFLASH_URL ?? "http://localhost:5183";

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((path) => existsSync(path));

if (!CHROME) {
  console.error("No Chrome or Chromium found; skipping screenshots.");
  process.exit(0);
}

// Both shots come from the same deep-linked page; the second is cropped to the
// procedure, which starts below the fold. Crop offsets are in CSS pixels and
// are multiplied by the device scale factor below.
const SHOTS = [
  { name: "device-and-os", query: "?device=sunfish&os=lineageos", height: 2000 },
  { name: "procedure", query: "?device=sunfish&os=lineageos", height: 5600, crop: { y: 1960, height: 2700 } },
];

const SCALE = 2;

mkdirSync(OUT, { recursive: true });

for (const shot of SHOTS) {
  const out = join(OUT, `${shot.name}.png`);
  execFileSync(CHROME, [
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    `--force-device-scale-factor=${SCALE}`,
    `--window-size=1100,${shot.height}`,
    "--virtual-time-budget=6000",
    `--screenshot=${out}`,
    `${BASE}/${shot.query}`,
  ], { stdio: "inherit" });

  if (shot.crop) {
    // sips is on every Mac; skip the crop rather than fail elsewhere.
    try {
      execFileSync("sips", [
        "-c", String(shot.crop.height * SCALE), String(1100 * SCALE),
        "--cropOffset", String(shot.crop.y * SCALE), "0",
        out,
      ], { stdio: "ignore" });
    } catch {
      console.warn(`could not crop ${shot.name}; leaving the full-page image`);
    }
  }

  console.log(`${shot.name} -> ${out}`);
}
