# openflash — notes

Repo-specific facts worth keeping. Working practice lives in the fleet notes,
not here.

## Started

2026-08-25. Built in one session from a standing start.

## The idea in one line

The LineageOS wiki generates its 733 per-device install pages from structured
YAML. That data is enough to *drive* an installer, not just print instructions.

## Where the device data comes from

`scripts/build-device-db.mjs` clones `LineageOS/lineage_wiki` (sparse, blobless)
and reduces `_data/devices/*.yml` to `public/data/devices.json`. The generated
file is **committed** so the app works offline and so a diff shows exactly what
changed upstream.

The fields that matter are `install_method`, `custom_unlock_cmd`,
`before_install`, `before_recovery_install.partitions`, `recovery_reboot`,
`recovery_partition_name`, `is_ab_device`, `is_ab_rdap`, `needs_fastboot_boot`
and `before_lineage_install`. Everything else in those YAMLs is spec-sheet
material and is dropped.

`src/core/plan.ts` is a re-expression of the wiki's
`_includes/templates/recovery_install_*.md` Liquid templates as typed steps.
**If the wiki changes those templates, this drifts.** There is no automatic
detection of that; `npm run check:plans` only catches structural breakage.

## Two engines, not twenty-eight

The 28 `install_method` values collapse to two things a browser can actually do:

- **recovery-sideload** — fastboot a recovery on, `adb sideload` the zip. 554 devices.
- **factory-zip** — `fastboot update` an AOSP factory image. GrapheneOS, CalyxOS.

The other 179 (Odin/`samloader_rs`, `dd`, `apx`, `edl_custom`, `nintendo`,
`amlogic_update`, `oor`) are explicitly refused in `src/core/methods.ts` with a
reason, rather than half-supported.

## The bug worth remembering

Free-form fastboot commands go on the wire **space-separated**, not
colon-separated. `fastboot flashing unlock` sends the string `flashing unlock`;
only the protocol's own commands (`getvar:`, `flash:`, `download:`) use colons.
The first cut colon-joined them, which would have failed on every device.

Related: two Nubia devices (`dopinder` and its sibling) have a **three-line**
`custom_unlock_cmd` with a `fastboot reboot bootloader` in the middle, and one
argument is shell-quoted. `src/core/unlock.ts` handles both, and
`npm run check:unlock` prints all 11 distinct unlock commands and what they
parse to. That module is deliberately free of USB imports so the check can run
in Node.

## Why the app cannot download the ROM

`download.lineageos.org/api/v2` **does** send CORS headers, so the build
manifest (filenames, sizes, SHA-256) is readable from the page. The mirrors it
points at (`mirrorbits.lineageos.org` → `ftp.fau.de` and friends) **do not**, so
`fetch()` on the actual zip is blocked. Hence: the user downloads, drops the file
in, and the page verifies it against the manifest. That is a better outcome than
a proxy would give — the verification is real and there is no server to trust —
but it was forced, not chosen.

Do not "fix" this by adding a proxy without a reason; it was considered and
rejected on 2026-08-25.

## Why SHA-256 is hand-written

`crypto.subtle.digest` wants the whole input as one buffer. The LineageOS zip
for sunfish is 1.12 GB. `src/core/sha256.ts` streams it instead.
`npm run check:sha256` verifies it against Node's `crypto` at every length where
the padding changes behaviour (55, 56, 63, 64, 119, 120, 127, 128 …), because
that is exactly where a hand-written hash goes wrong.

## Node checks and TypeScript

The checks in `scripts/` import the real `src/` modules via
`--experimental-strip-types` plus `scripts/ts-resolve.mjs` (which adds the `.ts`
extension Node's resolver demands and the bundler does not).

Strip-only mode **cannot handle TypeScript parameter properties**
(`constructor(private readonly x: T)`). `FastbootSession` and `AdbSession` use
them, which is why anything a check needs to import must not pull those in —
and why `parseUnlockCommand` lives in its own module.

## android-fastboot ships no types and no ESM entry

`types/android-fastboot.d.ts` declares the surface used. Its `package.json` names
only the CommonJS build, which drags a Node `url` import into the bundle, so
`vite.config.ts` aliases the package to `dist/fastboot.mjs`.

## State of testing

- Plan generation: all 733 devices, structurally checked.
- SHA-256: verified against a reference implementation.
- UI: driven end to end in a browser for `sunfish` (full plan), `lavender`
  (Xiaomi, vendor-portal unlock), `a52q` (Samsung, correctly refused).
- **WebUSB against real hardware: never.** No phone has been connected. The
  fastboot, ADB and sideload paths are unexercised.

The obvious next step is a Pixel 4a on the end of a cable.
