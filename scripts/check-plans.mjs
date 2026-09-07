#!/usr/bin/env node
// Smoke-test the plan builder against every device in the database.
//
// The point is not that the steps are *right* for all 733 -- only the wiki can
// say that -- but that none of them throws, none produces a step that needs a
// file the plan never asks for, and every device lands in a defensible bucket.
// A device data change upstream that breaks the generator should fail here
// rather than in front of somebody holding a phone.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { buildRecoveryPlan } = await import(join(ROOT, "src/core/plan.ts"));
const { methodInfo } = await import(join(ROOT, "src/core/methods.ts"));
const { other } = await import(join(ROOT, "src/distros/other.ts"));

const db = JSON.parse(readFileSync(join(ROOT, "public/data/devices.json"), "utf8"));

let planned = 0;
let unsupported = 0;
const problems = [];
const engines = {};
const unlocks = {};

for (const device of db.devices) {
  const info = methodInfo(device.install_method);
  engines[info.engine] = (engines[info.engine] ?? 0) + 1;
  unlocks[info.unlock.kind] = (unlocks[info.unlock.kind] ?? 0) + 1;

  let plan;
  try {
    plan = buildRecoveryPlan(device, {
      os: "TestOS",
      artifacts: [
        { key: "rom", label: "rom" },
        { key: "recovery", label: "recovery" },
        { key: "super_empty", label: "super_empty" },
        { key: "copy-partitions", label: "copy-partitions" },
        { key: "misc", label: "misc" },
        { key: "addon", label: "addon", optional: true },
        ...(device.before_recovery_install?.partitions ?? []).map((p) => ({
          key: `img:${p}`, label: p,
        })),
      ],
    });
  } catch (err) {
    problems.push(`${device.id}: threw ${err.message}`);
    continue;
  }

  if (plan.unsupported) { unsupported++; continue; }
  planned++;

  const ids = structural(device.id, plan);

  // Every plan must reach a sideload of the ROM and must wipe before it.
  if (!ids.has("sideload-rom")) problems.push(`${device.id}: never installs the ROM`);
  if (!ids.has("format-data")) problems.push(`${device.id}: never formats data`);
  if (!ids.has("to-recovery") && !ids.has("boot-recovery")) {
    problems.push(`${device.id}: never gets into recovery`);
  }

  // The catch-all "another ROM" entry builds its own artefact list from the
  // device record, on either engine. It must be as well-formed as the rest.
  for (const engine of ["recovery-sideload", "factory-zip"]) {
    other.settings.find((s) => s.key === "engine").value = engine;
    let generic;
    try {
      generic = await other.plan(device, null);
    } catch (err) {
      problems.push(`${device.id} [other/${engine}]: threw ${err.message}`);
      continue;
    }
    const got = structural(`${device.id} [other/${engine}]`, generic);
    const install = engine === "factory-zip" ? "flash-factory" : "sideload-rom";
    if (!got.has(install)) problems.push(`${device.id} [other/${engine}]: never installs the ROM`);
  }
}

/** Step ids are unique, every step is runnable or confirmable, and every
 *  file a step needs is one the plan asks the user for. Returns the ids. */
function structural(label, plan) {
  const steps = plan.phases.flatMap((phase) => phase.steps);
  const ids = new Set();
  const keys = new Set(plan.artifacts.map((a) => a.key));

  for (const step of steps) {
    if (ids.has(step.id)) problems.push(`${label}: duplicate step id "${step.id}"`);
    ids.add(step.id);
    if (!step.run && !step.confirm) {
      problems.push(`${label}: step "${step.id}" is neither runnable nor confirmable`);
    }
    for (const need of step.needs ?? []) {
      if (!keys.has(need)) {
        problems.push(`${label}: step "${step.id}" needs "${need}", which no artefact provides`);
      }
    }
  }
  return ids;
}

console.log(`devices:      ${db.devices.length}`);
console.log(`planned:      ${planned}`);
console.log(`unsupported:  ${unsupported}`);
console.log(`engines:      ${JSON.stringify(engines)}`);
console.log(`unlock route: ${JSON.stringify(unlocks)}`);

if (problems.length > 0) {
  console.error(`\n${problems.length} problems:`);
  for (const problem of problems.slice(0, 40)) console.error(`  ${problem}`);
  process.exit(1);
}
console.log("\nno problems");
