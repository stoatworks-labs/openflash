// The other OSes.
//
// None of these publish a build manifest a browser can read — their download
// servers send no CORS headers — so unlike LineageOS we cannot look up the
// current build, cannot list which devices are supported today, and cannot
// verify a checksum we were never given. Rather than bake in a device list that
// silently rots, each of these says what it does not know and sends you to the
// project's own page with your codename already in hand.
//
// What they *can* still do is drive the flash itself, which is the part that
// actually goes wrong.

import type { BuildInfo, DeviceRecord, Distro, Plan, Support } from "../types";
import { buildFactoryPlan, buildRecoveryPlan } from "../core/plan";

/**
 * /e/OS — Murena's de-Googled LineageOS derivative, installed the same way
 * LineageOS is: their recovery, then their zip.
 */
export const eos: Distro = {
  id: "eos",
  name: "/e/OS",
  href: "https://e.foundation",
  blurb:
    "A de-Googled LineageOS derivative with its own account and cloud services, " +
    "aimed at people who want a phone that works out of the box without Google.",

  async supports(device: DeviceRecord): Promise<Support> {
    return {
      supported: false,
      detail:
        "Murena's servers do not allow this page to read their device list, so " +
        "check the codename against their documentation before you start. The " +
        "install procedure below is the standard recovery-and-sideload one.",
      href: `https://doc.e.foundation/devices/${device.codename}/install`,
    };
  },

  async plan(device: DeviceRecord, _build: BuildInfo | null): Promise<Plan> {
    return buildRecoveryPlan(device, {
      os: "/e/OS",
      reference: {
        label: `/e/OS documentation for ${device.codename}`,
        href: `https://doc.e.foundation/devices/${device.codename}/install`,
      },
      artifacts: [
        {
          key: "rom",
          label: "/e/OS zip",
          url: `https://doc.e.foundation/devices/${device.codename}/install`,
          note: "Take the 'community' or 'official' build for your device from Murena's downloads.",
        },
        {
          key: "recovery",
          label: `Recovery image (${device.recovery_partition_name ?? "recovery"}.img)`,
          filename: `${device.recovery_partition_name ?? "recovery"}.img`,
          url: `https://doc.e.foundation/devices/${device.codename}/install`,
          note: "/e/OS ships its own recovery; do not substitute the LineageOS one.",
        },
        ...(device.before_recovery_install?.partitions ?? []).map((p) => ({
          key: `img:${p}`,
          label: `${p}.img`,
          filename: `${p}.img`,
          note: "From the same build as the ROM.",
        })),
        {
          key: "addon",
          label: "Add-on package (optional)",
          optional: true,
          note: "/e/OS includes microG already; most people need nothing here.",
        },
      ],
      addons: true,
    });
  },
};

/** CalyxOS — factory-image based, Pixel and Fairphone. */
export const calyxos: Distro = {
  id: "calyxos",
  name: "CalyxOS",
  href: "https://calyxos.org",
  blurb:
    "Privacy-focused, ships microG and Datura firewall, and keeps the bootloader " +
    "re-lockable. Supports a short, current list of Pixels and Fairphones.",

  async supports(device: DeviceRecord): Promise<Support> {
    const plausible = device.vendor_short === "google" || device.vendor_short === "fairphone";
    return {
      supported: false,
      detail: plausible
        ? "CalyxOS supports a small, moving list of recent Pixels and Fairphones, " +
          "and drops devices as Google's own support ends. This page cannot read " +
          "that list — check your codename on their site first."
        : `CalyxOS builds only for Pixel and Fairphone hardware, so a ${device.vendor} ` +
          "device is out of scope.",
      href: "https://calyxos.org/docs/guide/device-support/",
    };
  },

  async plan(device: DeviceRecord, _build: BuildInfo | null): Promise<Plan> {
    return buildFactoryPlan(device, {
      os: "CalyxOS",
      reference: { label: "CalyxOS install guide", href: "https://calyxos.org/install/" },
      relock: true,
      notes: [
        {
          note:
            "CalyxOS normally installs through their own device-flasher binary. This " +
            "page does the same job over WebUSB; if anything here disagrees with " +
            "their guide, believe their guide.",
        },
      ],
      artifacts: [
        {
          key: "factory",
          label: "CalyxOS factory image zip",
          url: "https://calyxos.org/install/",
          note:
            "The full factory zip for your device, not an OTA. Verify its signature " +
            "with the instructions on their download page — this tool has no " +
            "checksum from CalyxOS to check it against.",
        },
      ],
    });
  },
};

/** GrapheneOS — factory-image based, Pixel only, re-locks with its own key. */
export const grapheneos: Distro = {
  id: "grapheneos",
  name: "GrapheneOS",
  href: "https://grapheneos.org",
  blurb:
    "The hardening-focused one. Pixel only, because it depends on hardware " +
    "features and a verified-boot story most vendors do not offer.",

  async supports(device: DeviceRecord): Promise<Support> {
    if (device.vendor_short !== "google") {
      return {
        supported: false,
        detail:
          `GrapheneOS builds only for Pixels, because it requires the verified-boot ` +
          `and firmware-update guarantees Google provides and ${device.vendor} does not.`,
        href: "https://grapheneos.org/faq#supported-devices",
      };
    }
    return {
      supported: false,
      detail:
        "GrapheneOS supports current Pixels and drops older ones as Google's " +
        "firmware support ends — and it has an official web installer of its own, " +
        "which is the better route. Check your device there first.",
      href: "https://grapheneos.org/install/web",
    };
  },

  async plan(device: DeviceRecord, _build: BuildInfo | null): Promise<Plan> {
    return buildFactoryPlan(device, {
      os: "GrapheneOS",
      reference: { label: "GrapheneOS web install", href: "https://grapheneos.org/install/web" },
      relock: true,
      notes: [
        {
          warn:
            "GrapheneOS runs its own official WebUSB installer at grapheneos.org/install/web. " +
            "Use it rather than this page: it is maintained by the project, it verifies " +
            "the release signature, and it handles their AVB key correctly.",
        },
      ],
      artifacts: [
        {
          key: "factory",
          label: "GrapheneOS factory image zip",
          url: "https://grapheneos.org/releases",
          note:
            "Verify the release signature with signify as their instructions describe. " +
            "A checksum this page invented for you would be worth nothing.",
        },
      ],
    });
  },
};
