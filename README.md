# openflash

> **AI-assisted project.** This codebase was created with [Claude](https://claude.com/claude-code)
> (Anthropic), directed and reviewed by a human author. The plan generator is
> checked against all 733 devices in the LineageOS device database, and the
> SHA-256 implementation is verified against a reference implementation at every
> block boundary — but **no phone has ever been connected to this code**. The
> WebUSB fastboot and sideload paths are unexercised against real hardware.
> Treat it accordingly.

Install LineageOS and other alternative Android systems from a browser. It talks
to the phone over WebUSB, does the parts a machine should do, and tells you
plainly which parts only you can do.

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/device-and-os.png" width="420" alt="Device detected as a Pixel 4a, with six operating systems offered and their support status"><br><sub>pick a device, pick a system</sub></td>
    <td align="center"><img src="docs/screenshots/procedure.png" width="420" alt="The generated procedure for a Pixel 4a, with manual and automatic steps and their equivalent commands"><br><sub>the procedure it generates for that pair</sub></td>
  </tr>
</table>

## What it does

**Autodetects the phone.** Plug it in and the page reads its codename, model,
Android version, security patch level, bootloader version, slot layout and lock
state — over ADB if it is booted, over fastboot if it is in the bootloader. If
the codename does not match the procedure you have selected, it refuses to
carry on rather than flash one device's build onto another.

**Generates the procedure for that exact device.** Not a generic guide with
"(on some devices)" scattered through it. The Pixel 4a gets its `dtbo` partition
step and its stock-Android-13 firmware requirement; a Xiaomi gets told that Mi
Unlock and a seven-day wait stand between it and anything else on the page; a
Samsung gets told this tool cannot flash it at all, because Odin is not fastboot.

**Runs the parts a machine should run.** Unlocking, flashing partitions,
`adb sideload` of the ROM zip — all over WebUSB, with progress. The parts only a
human can do — holding Volume Down, answering the phone's own unlock prompt,
picking "Format data" out of a recovery menu — are marked as such and wait for
you.

**Shows the equivalent commands anyway.** Every automated step prints the `adb`
and `fastboot` commands it stands in for. That is what makes the page useful in
Firefox and Safari, which have no WebUSB — you get a correct, ordered,
device-specific command list instead — and it is how you check what the page is
about to do before you let it.

**Verifies what you feed it.** LineageOS publishes a machine-readable build
manifest, so files you drop in are hashed in the page and checked against the
SHA-256 for that exact build. A file that does not match is not flashed.

## Devices

The device database is generated from the LineageOS wiki's own
[`_data/devices/*.yml`](https://github.com/LineageOS/lineage_wiki/tree/main/_data/devices),
which is what drives their install pages. That is 733 devices across 28 install
methods.

| | devices |
| --- | ---: |
| Full procedure generated | 554 |
| Not flashable from a browser (Odin, `dd`, APX, EDL, …) | 179 |
| …of the 554, unlocked by a fastboot command | 217 |
| …unlocked only through the vendor's own portal | 328 |
| …already unlocked, or no unlock step | 9 |

Regenerate after an upstream change:

```bash
npm run devices
```

## Systems

| | how it installs | what this tool knows |
| --- | --- | --- |
| **LineageOS** | recovery + sideload | Everything: live build list, exact filenames, sizes and SHA-256 per build |
| **/e/OS** | recovery + sideload | Procedure only — Murena's servers block browser reads, so bring your own files |
| **CalyxOS** | factory image zip | Procedure only, and their device list moves; check it first |
| **GrapheneOS** | factory image zip | Procedure only — and they have their own official web installer, which you should use instead |
| **iodéOS**, **DivestOS** | recovery + sideload | Via JSON profiles in `public/profiles/` |

Any other ROM can be added as a profile — a dozen lines of JSON naming the
project, its download page and which of the two engines it uses. No code.

## Running it

```bash
npm install && npm run dev
```

It is a static site with no server component, so `npm run build` produces
something you can drop on any static host. Deep links work:
`?device=sunfish&os=lineageos` opens straight onto the procedure for a Pixel 4a.

WebUSB needs Chrome, Edge, or another Chromium browser. Everything except the
flashing itself works everywhere.

## Checks

```bash
npm run check
```

- **`check:sha256`** — the hand-written incremental SHA-256 against Node's
  `crypto`, at every length where the padding changes behaviour.
- **`check:unlock`** — every distinct unlock command in the database parses into
  something sendable. This caught a real bug: free-form fastboot commands go on
  the wire with spaces (`flashing unlock`), not colons, and two Nubia devices
  carry a three-line unlock sequence with a reboot in the middle.
- **`check:plans`** — a plan is generated for all 733 devices; no step may
  require a file the plan never asks for, no plan may reach a sideload without
  formatting data first.

## What this is not

It is not a replacement for the LineageOS wiki. The wiki is the authority; this
page is generated from its data and links back to the page for your device on
every screen. Where the two disagree, the wiki is right and this is a bug.

It does not download ROMs for you, because it cannot: the mirrors send no CORS
headers, so a web page is not permitted to fetch from them. You download, you
drop the file in, the page checks it.

It will not pretend a vendor-locked bootloader is one command away.

## Licence

MIT. See [LICENSE](LICENSE) and [ATTRIBUTIONS.md](ATTRIBUTIONS.md).
