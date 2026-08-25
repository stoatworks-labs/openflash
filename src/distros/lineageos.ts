// LineageOS.
//
// The only project here whose build manifest a browser can actually read:
// download.lineageos.org's API sends CORS headers, so we can look up the exact
// filenames, sizes and SHA-256 of the newest build for a device and check what
// the user hands us against it. The mirrors themselves do not send those
// headers, which is why we link to the files rather than fetching them.

import type { Artifact, BuildInfo, DeviceRecord, Distro, Plan, Support } from "../types";
import { buildRecoveryPlan } from "../core/plan";

const API = "https://download.lineageos.org/api/v2";

interface ApiFile {
  filename: string;
  filepath: string;
  sha256: string;
  size: number;
  url: string;
}
interface ApiBuild {
  date: string;
  datetime: number;
  type: string;
  version: string;
  files: ApiFile[];
}

const COPY_PARTITIONS_URL =
  "https://mirrorbits.lineageos.org/tools/copy-partitions-20220613-signed.zip";

export const lineageos: Distro = {
  id: "lineageos",
  name: "LineageOS",
  href: "https://lineageos.org",
  blurb:
    "The largest of the alternative Android distributions, and the one nearly " +
    "everything else here is derived from. No Google services unless you add them.",

  async supports(device: DeviceRecord): Promise<Support> {
    if (device.migrated_to) {
      return {
        supported: false,
        detail: `The wiki has folded this device into "${device.migrated_to}" — use that entry instead.`,
      };
    }
    if (!device.maintained) {
      return {
        supported: false,
        detail:
          "No current maintainer, so there are no official builds. The install " +
          "procedure below still applies to a build you make yourself.",
        href: `https://wiki.lineageos.org/devices/${device.codename}/build`,
      };
    }
    return {
      supported: true,
      detail: `Official builds, currently LineageOS ${device.current_branch ?? "?"}.`,
      href: `https://wiki.lineageos.org/devices/${device.codename}`,
    };
  },

  async builds(device: DeviceRecord): Promise<BuildInfo[]> {
    const response = await fetch(`${API}/devices/${device.codename}/builds`);
    if (!response.ok) {
      throw new Error(`LineageOS build list returned HTTP ${response.status}.`);
    }
    const builds = (await response.json()) as ApiBuild[];

    return builds
      .slice()
      .sort((a, b) => b.datetime - a.datetime)
      .map((build) => ({
        version: `${build.version} ${build.type}`,
        date: build.date,
        files: mapFiles(device, build),
      }));
  },

  async plan(device: DeviceRecord, build: BuildInfo | null): Promise<Plan> {
    return buildRecoveryPlan(device, {
      os: "LineageOS",
      osVersion: build?.version,
      reference: {
        label: `LineageOS wiki: installing on ${device.codename}`,
        href: `https://wiki.lineageos.org/devices/${device.codename}/install`,
      },
      artifacts: build ? build.files : fallbackArtifacts(device),
      addons: true,
    });
  },
};

/**
 * Turn a build's file list into the artefacts the plan asks for. The plan
 * refers to things by role ("recovery", "img:dtbo"); the API lists them by
 * filename, so this is where the two are joined up.
 */
function mapFiles(device: DeviceRecord, build: ApiBuild): Artifact[] {
  const byName = new Map(build.files.map((f) => [f.filename, f]));
  const artifacts: Artifact[] = [];

  const add = (key: string, filename: string, label: string, extra: Partial<Artifact> = {}) => {
    const file = byName.get(filename);
    artifacts.push({
      key,
      label,
      filename,
      url: file?.url,
      sha256: file?.sha256,
      size: file?.size,
      ...extra,
    });
  };

  const zip = build.files.find((f) => f.filename.endsWith(".zip"));
  if (zip) {
    artifacts.push({
      key: "rom",
      label: `LineageOS ${build.version} (${build.date})`,
      filename: zip.filename,
      url: zip.url,
      sha256: zip.sha256,
      size: zip.size,
    });
  }

  // The recovery image is published under the name of the partition it goes
  // on, which is `boot` on A/B devices and `recovery` on older ones.
  const partition = device.recovery_partition_name ?? "recovery";
  add("recovery", `${partition}.img`, `Lineage Recovery (${partition}.img)`);

  for (const p of device.before_recovery_install?.partitions ?? []) {
    add(`img:${p}`, `${p}.img`, `${p} partition image`);
  }

  if (device.is_ab_rdap) {
    add("super_empty", "super_empty.img", "Empty super partition");
  }

  if (device.before_lineage_install === "ab_copy_partitions") {
    artifacts.push({
      key: "copy-partitions",
      label: "copy-partitions-20220613-signed.zip",
      filename: "copy-partitions-20220613-signed.zip",
      url: COPY_PARTITIONS_URL,
      note: "Copies firmware to the inactive slot. Not part of the per-build downloads.",
    });
  }

  if (device.recovery_reboot === "fastboot_misc") {
    artifacts.push({
      key: "misc",
      label: "boot-recovery-misc.img",
      filename: "boot-recovery-misc.img",
      url: "https://blob.lineageos.org/downloads/boot-recovery-misc.img",
    });
  }

  artifacts.push({
    key: "addon",
    label: `Add-on package (optional, ${device.architecture.userspace})`,
    optional: true,
    url: "https://wiki.lineageos.org/gapps",
    note:
      "Google Apps or any other add-on. Leave empty for a clean install with no " +
      "Google services.",
  });

  return artifacts;
}

/** Used when the API is unreachable: same roles, no checksums to verify against. */
function fallbackArtifacts(device: DeviceRecord): Artifact[] {
  const partition = device.recovery_partition_name ?? "recovery";
  const downloads = `https://download.lineageos.org/devices/${device.codename}`;
  const artifacts: Artifact[] = [
    { key: "rom", label: "LineageOS zip", url: downloads },
    { key: "recovery", label: `Lineage Recovery (${partition}.img)`, filename: `${partition}.img`, url: downloads },
  ];
  for (const p of device.before_recovery_install?.partitions ?? []) {
    artifacts.push({ key: `img:${p}`, label: `${p}.img`, filename: `${p}.img`, url: downloads });
  }
  if (device.is_ab_rdap) {
    artifacts.push({ key: "super_empty", label: "super_empty.img", filename: "super_empty.img", url: downloads });
  }
  if (device.before_lineage_install === "ab_copy_partitions") {
    artifacts.push({ key: "copy-partitions", label: "copy-partitions-20220613-signed.zip", url: COPY_PARTITIONS_URL });
  }
  artifacts.push({ key: "addon", label: "Add-on package (optional)", optional: true, url: "https://wiki.lineageos.org/gapps" });
  return artifacts;
}
