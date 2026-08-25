# AGENTS.md — bringing an LLM up to speed on openflash

Orientation for an AI assistant (or a new human) picking this up cold.

## 1. What this is

A browser-based installer for LineageOS and other alternative Android systems.
It speaks fastboot and ADB over WebUSB, detects the connected phone, generates
the install procedure for that exact device, runs the automatable parts, and
tells the user which parts they have to do themselves.

Static site. No server. Vite + TypeScript, no UI framework.

## 2. The thing that makes this repo different: the data is upstream

Nearly everything device-specific comes from the **LineageOS wiki's** device
YAML, generated into `public/data/devices.json`. The step generator in
`src/core/plan.ts` is a re-expression of the wiki's own Liquid templates.

So: **this repo does not own the truth about how to flash a phone.** The wiki
does. When they disagree, the wiki is right, and the fix goes in the generator
or the plan builder — not in a hard-coded special case for one device.

## 3. Layout

```
scripts/            Generators and checks. All run under Node's --experimental-strip-types.
  build-device-db.mjs   LineageOS wiki -> public/data/devices.json
  check-*.mjs           The three correctness checks; see CLAUDE.md
src/core/
  plan.ts           The heart: DeviceRecord -> ordered, executable Step[]
  methods.ts        install_method -> engine + unlock route. Where devices get refused.
  unlock.ts         Parsing custom_unlock_cmd. No USB imports, deliberately.
  fastboot.ts       WebUSB fastboot, wrapping android-fastboot
  adb.ts            WebUSB ADB, wrapping ya-webadb
  sideload.ts       AOSP sideload-host protocol, hand-implemented
  sha256.ts         Streaming SHA-256 (WebCrypto can't do 1.2 GB)
src/distros/        One adapter per OS; generic.ts loads JSON profiles
src/ui/             The page. Plain DOM.
```

## 4. Traps

- **Colon vs space in fastboot commands.** `flash:boot` uses a colon;
  `flashing unlock` and `oem …` use a space. Getting this backwards silently
  breaks unlocking on every device. See `src/core/unlock.ts`.
- **Sideload is not sequential.** Recovery re-reads earlier blocks (A/B payload
  metadata), so `sideload.ts` seeks rather than streams, and progress is a high
  water mark or the bar goes backwards.
- **Sessions die on reboot.** The phone reboots several times mid-install.
  `getFastboot`/`getAdb` in `src/ui/app.ts` re-open on demand, and only ever run
  inside a click handler because WebUSB requires a user gesture.
- **Do not add automation for a vendor-portal unlock.** Xiaomi, Motorola, Sony,
  HTC and others cannot be unlocked by a command. Telling a user otherwise strands
  them at the step where the next wrong move wipes the phone. `methods.ts` is the
  register of who is in which category, with the reason.
- **Do not claim support you cannot verify.** Only LineageOS exposes a
  browser-readable manifest. For the others the honest answer is "check the
  project's page", and that is what the UI says.

## 5. Before committing

`npm run check`. It is fast and it has already caught a real bug.
