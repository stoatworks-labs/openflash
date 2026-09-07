// Any ROM you already have the files for.
//
// There are far more Android distributions than anybody will write an adapter
// or even a profile for, and most of them install one of the two ways this
// page can drive. This is the entry for those. It knows nothing about the ROM
// — no device list, no build manifest, no checksum — and says so. What it
// still knows is the device: the unlock route, the recovery partition, the
// extra images this handset needs before a recovery will boot, the wipe. That
// is the part that goes wrong, and it comes from the same wiki data as every
// other system here.
//
// The user brings the files and the project's own guide. Where that guide and
// this page disagree, the guide is right.

import type { BuildInfo, DeviceRecord, Distro, Plan, Setting, Support } from "../types";
import { buildFactoryPlan, buildRecoveryPlan, deviceArtifacts } from "../core/plan";

const FALLBACK_NAME = "Another ROM";

const name: Setting = {
  key: "name",
  label: "What is it called",
  hint: "Only used to label the procedure.",
  value: "",
};

const engine: Setting = {
  key: "engine",
  label: "How does it install",
  value: "recovery-sideload",
  choices: [
    {
      value: "recovery-sideload",
      label: "Recovery and sideload",
      hint:
        "A recovery image flashed with fastboot, then a ROM zip pushed into it with " +
        "adb sideload. LineageOS and nearly every derivative install this way. This " +
        "engine has been run end to end on hardware from this page.",
    },
    {
      value: "factory-zip",
      label: "Factory image zip",
      hint:
        "One zip flashed by the bootloader, the way fastboot update does it. " +
        "Pixel-style projects only. This engine has never been run on hardware " +
        "from this page.",
    },
  ],
};

const osName = () => name.value.trim() || FALLBACK_NAME;

export const other: Distro = {
  id: "other",
  name: FALLBACK_NAME,
  href: "https://xdaforums.com/",
  blurb:
    "Anything else you already have the files for. This page cannot check the " +
    "files or the device list, but it can still drive the flash for your exact device.",
  settings: [name, engine],

  async supports(device: DeviceRecord): Promise<Support> {
    return {
      supported: false,
      detail:
        `Nothing here can tell you whether the ROM you hold builds for the ${device.name}. ` +
        `Its own download page can: bring the files it lists for the codename ` +
        `"${device.codename}", and nothing built for any other.`,
    };
  },

  async plan(device: DeviceRecord, _build: BuildInfo | null): Promise<Plan> {
    const os = osName();
    const notes = [
      {
        warn:
          `This page knows nothing about ${os}. It has no checksum to check your files ` +
          "against, so it will flash whatever you give it: compare each hash it shows " +
          "with the one the project publishes before you continue.",
      },
      {
        note:
          `The device-specific steps below come from the LineageOS wiki's record of the ` +
          `${device.name}. ${os} may need something the wiki does not — a vendor image, ` +
          "a different recovery, a firmware version. Read its own guide first, and where " +
          "the two disagree, believe the guide.",
      },
    ];

    if (engine.value === "factory-zip") {
      return buildFactoryPlan(device, {
        os,
        relock: false,
        notes: [
          ...notes,
          {
            warn:
              "The factory-image engine has never been run against a phone from this " +
              "page. The commands it prints are the tested route; use them if in doubt.",
          },
        ],
        artifacts: [
          {
            key: "factory",
            label: `${os} factory image zip`,
            note: "The full factory zip for this device, not an OTA.",
          },
        ],
      });
    }

    const partition = device.recovery_partition_name ?? "recovery";
    return buildRecoveryPlan(device, {
      os,
      notes,
      addons: true,
      artifacts: [
        {
          key: "rom",
          label: `${os} zip`,
          note: `The build for "${device.codename}", from the project's own downloads.`,
        },
        {
          key: "recovery",
          label: `Recovery image (${partition}.img)`,
          filename: `${partition}.img`,
          note:
            "The recovery the project ships for this build, if it has one. Most " +
            "LineageOS derivatives require their own; check the guide before " +
            "substituting the LineageOS one.",
        },
        ...deviceArtifacts(device),
        {
          key: "addon",
          label: "Add-on package",
          optional: true,
          note: "Google apps or similar, only if the project says its build takes them.",
        },
      ],
    });
  },
};
