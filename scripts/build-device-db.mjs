#!/usr/bin/env node
// Build the device database from the LineageOS wiki's own device data.
//
// The wiki (github.com/LineageOS/lineage_wiki) drives its per-device install
// pages from `_data/devices/*.yml`. Those files carry exactly the facts an
// installer needs -- which install method the device uses, what its unlock
// command is, which extra partitions must be flashed before recovery, which
// button combo enters the bootloader -- so we generate from them rather than
// re-typing 700+ device procedures by hand.
//
// Output: public/data/devices.json (committed, so the app works offline and
// so a diff shows exactly what upstream changed).

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "data", "devices.json");
const REPO = "https://github.com/LineageOS/lineage_wiki.git";

// Fields we keep. Everything else in the YAML is spec-sheet material (camera
// megapixels, screen size) that has no bearing on flashing.
const KEEP = [
  "codename", "name", "vendor", "vendor_short", "type", "architecture",
  "current_branch", "versions", "install_method", "custom_unlock_cmd",
  "no_oem_unlock_switch", "is_ab_device", "is_ab_rdap", "uses_twrp",
  "needs_fastboot_boot", "has_no_usb", "stock_is_not_android",
  "recovery_partition_name", "recovery_reboot", "recovery_boot", "download_boot",
  "before_install", "before_recovery_install", "before_lineage_install",
  "custom_recovery_link", "custom_recovery_codename", "custom_lineage_recovery",
  "models", "required_bootloader", "maintainers", "image", "migrated_to",
];

function checkout() {
  const dir = mkdtempSync(join(tmpdir(), "lineage-wiki-"));
  execFileSync("git", ["clone", "--depth", "1", "--filter=blob:none", "--sparse", REPO, dir], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  execFileSync("git", ["-C", dir, "sparse-checkout", "set", "_data/devices"], { stdio: "ignore" });
  const sha = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return { dir, sha };
}

function main() {
  const { dir, sha } = checkout();
  const src = join(dir, "_data", "devices");
  const devices = [];

  try {
    for (const file of readdirSync(src).sort()) {
      if (!file.endsWith(".yml")) continue;
      const raw = yaml.load(readFileSync(join(src, file), "utf8"));
      if (!raw || typeof raw !== "object") continue;

      const d = {};
      for (const key of KEEP) if (raw[key] !== undefined) d[key] = raw[key];

      // `architecture` is either a plain string ("arm64") or a split
      // {cpu, userspace} pair. Normalise to the split form: the userspace
      // arch is what decides which add-on packages (e.g. GApps) apply.
      const arch = d.architecture;
      d.architecture = typeof arch === "string"
        ? { cpu: arch, userspace: arch }
        : { cpu: arch?.cpu ?? "unknown", userspace: arch?.userspace ?? arch?.cpu ?? "unknown" };

      // A device with no maintainers has no official builds; the wiki tells
      // such users to build it themselves. Worth surfacing, not hiding.
      d.maintained = Array.isArray(d.maintainers) && d.maintainers.length > 0;
      delete d.maintainers;

      // The wiki's YAML markup ("<kbd>Volume Down</kbd> + <kbd>Power</kbd>")
      // renders as HTML in the page. We render it as text, so strip the tags
      // but keep the key names.
      for (const key of ["recovery_boot", "download_boot"]) {
        if (typeof d[key] === "string") d[key] = stripMarkup(d[key]);
      }

      // Variant files (foo_variant1.yml) all share one codename; keep the
      // filename so variants stay distinguishable in the picker.
      d.id = file.replace(/\.yml$/, "");
      devices.push(d);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const methods = {};
  for (const d of devices) methods[d.install_method ?? "none"] = (methods[d.install_method ?? "none"] ?? 0) + 1;

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    source: { repo: "LineageOS/lineage_wiki", commit: sha },
    count: devices.length,
    methods,
    devices,
  }) + "\n");

  console.log(`${devices.length} devices from lineage_wiki@${sha.slice(0, 8)} -> ${OUT}`);
  const top = Object.entries(methods).sort((a, b) => b[1] - a[1]);
  console.log(`${top.length} install methods, top 5: ${top.slice(0, 5).map(([m, n]) => `${m}=${n}`).join(" ")}`);
}

function stripMarkup(s) {
  return s
    .replace(/<kbd>(.*?)<\/kbd>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\*([^*]+)\*/g, "$1")
    .trim();
}

main();
