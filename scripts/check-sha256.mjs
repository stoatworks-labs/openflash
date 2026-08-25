#!/usr/bin/env node
// The SHA-256 in src/core/sha256.ts is hand-written, because WebCrypto cannot
// hash a 1.2 GB file without holding all of it in memory. Hand-written hashes
// are exactly the kind of code that is subtly wrong at the block boundaries,
// so check it against a reference implementation at every awkward length.
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { sha256Bytes, sha256File } = await import(join(ROOT, "src/core/sha256.ts"));

// Around 55/56 the length field stops fitting in the final block; 64 and 128
// are exact multiples; the rest are ordinary.
const LENGTHS = [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 65536, 1_000_003];

let failures = 0;
for (const length of LENGTHS) {
  const buffer = randomBytes(length);
  const mine = sha256Bytes(new Uint8Array(buffer));
  const reference = createHash("sha256").update(buffer).digest("hex");
  if (mine !== reference) {
    console.error(`FAIL length=${length}\n  got      ${mine}\n  expected ${reference}`);
    failures++;
  }
}

// The streaming path, which is the one that actually runs on a ROM zip.
const big = randomBytes(3_000_000);
const streamed = await sha256File(new File([big], "big.bin"));
const reference = createHash("sha256").update(big).digest("hex");
if (streamed !== reference) {
  console.error(`FAIL streaming\n  got      ${streamed}\n  expected ${reference}`);
  failures++;
}

console.log(failures === 0 ? `${LENGTHS.length + 1} sha256 cases pass` : `${failures} FAILURES`);
process.exit(failures ? 1 : 0);
