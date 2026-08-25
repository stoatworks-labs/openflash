# Attributions

openflash is built on other people's work. This file lists what that work is,
who did it, and what it is doing here.

## Third-party code this project uses

### fastboot.js (`android-fastboot`)

<https://github.com/kdrag0n/fastboot.js>
Licence: MIT
Copyright: Danny Lin

An npm dependency. Implements the Android fastboot protocol over WebUSB —
unlocking, flashing raw and sparse images, splitting images larger than the
bootloader's download limit, and flashing AOSP factory-image zips. Every
`fastboot` operation this project performs goes through it.

### ya-webadb (`@yume-chan/adb` and friends)

<https://github.com/yume-chan/ya-webadb>
Licence: MIT
Copyright: Simon Chan

An npm dependency. Implements the ADB protocol over WebUSB, including the RSA
authentication handshake and the key store. Used for reading device properties
and for the socket that `adb sideload` runs over.

The sideload command itself is not part of ya-webadb; `src/core/sideload.ts` is
an implementation of the AOSP `sideload-host` protocol on top of its socket API.

### Vite and TypeScript

<https://vite.dev> · <https://www.typescriptlang.org>
Licence: MIT · Apache-2.0

Build tooling.

## Data this project uses

### The LineageOS wiki device database

<https://github.com/LineageOS/lineage_wiki>
Licence: CC BY-SA 3.0 for the wiki content
Copyright: The LineageOS Project and wiki contributors

`public/data/devices.json` is generated from `_data/devices/*.yml` in that
repository by `scripts/build-device-db.mjs`. Those files are what drive the
wiki's own per-device install pages, and the step generator in
`src/core/plan.ts` is a re-expression of the same Liquid templates.

This project is not affiliated with or endorsed by the LineageOS project. The
wiki is the authority on how to install LineageOS; this is a tool that reads
its data.

## Trademarks

Android is a trademark of Google LLC. LineageOS, /e/OS, CalyxOS, GrapheneOS,
iodéOS and DivestOS are the marks of their respective projects. Naming them here
describes compatibility; it does not imply any endorsement by them.
