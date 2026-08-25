#!/usr/bin/env node
// Check every unlock command in the database parses into something sendable.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { parseUnlockCommand } = await import(join(ROOT, "src/core/unlock.ts"));
const db = JSON.parse(readFileSync(join(ROOT, "public/data/devices.json"), "utf8"));

const seen = new Map();
for (const device of db.devices) {
  if (!device.custom_unlock_cmd) continue;
  if (!seen.has(device.custom_unlock_cmd)) seen.set(device.custom_unlock_cmd, device.codename);
}

let failed = 0;
for (const [command, codename] of seen) {
  const ops = parseUnlockCommand(command);
  const shown = ops.map((op) => (op.kind === "reboot" ? `reboot(${op.target})` : `"${op.text}"`)).join(" then ");
  console.log(`${codename.padEnd(12)} ${JSON.stringify(command)}\n${" ".repeat(13)}-> ${shown}`);

  if (ops.length === 0) { console.error("  EMPTY"); failed++; }
  for (const op of ops) {
    if (op.kind !== "raw") continue;
    if (op.text.includes("'") || op.text.includes('"')) { console.error("  quotes survived"); failed++; }
    if (op.text.startsWith("fastboot")) { console.error("  'fastboot' not stripped"); failed++; }
    // Free-form commands go on the wire with spaces; a colon here would mean
    // we had rewritten it into protocol-command form, which is the bug this
    // check exists to catch.
    if (/^(oem|flashing)[:]/.test(op.text)) { console.error("  colon-joined"); failed++; }
    if (op.text.length > 64) { console.error("  longer than the 64-byte command limit"); failed++; }
  }
}
console.log(failed === 0 ? `\n${seen.size} unlock commands, all parse` : `\n${failed} FAILURES`);
process.exit(failed ? 1 : 0);
