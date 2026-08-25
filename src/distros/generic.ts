// Any other ROM, described by a JSON profile.
//
// The point of this one: there are far more Android distributions than anybody
// is going to write an adapter for, and most of them install exactly the same
// way — fastboot a recovery on, sideload a zip. A profile is a dozen lines of
// JSON that says which ROM, which files, and which of the two engines, and the
// same machinery drives it.
//
// Profiles in public/profiles/*.json are loaded at startup; a user can also
// paste one in, which is how you handle an unofficial build for one device
// without waiting for anybody.

import type { Artifact, BuildInfo, DeviceRecord, Distro, Plan, Support } from "../types";
import { buildFactoryPlan, buildRecoveryPlan } from "../core/plan";

export interface Profile {
  id: string;
  name: string;
  href: string;
  blurb: string;
  engine: "recovery-sideload" | "factory-zip";
  /** Codenames this ROM builds for, or "*" for "ask the user". */
  devices: string[] | "*";
  /** Download page. `{codename}` is substituted. */
  downloads?: string;
  /** Extra artefacts beyond the ones the engine already asks for. */
  artifacts?: Artifact[];
  relock?: boolean;
  note?: string;
}

export function profileToDistro(profile: Profile): Distro {
  const link = (device: DeviceRecord) =>
    profile.downloads?.replaceAll("{codename}", device.codename) ?? profile.href;

  return {
    id: `profile:${profile.id}`,
    name: profile.name,
    href: profile.href,
    blurb: profile.blurb,

    async supports(device: DeviceRecord): Promise<Support> {
      if (profile.devices === "*") {
        return {
          supported: false,
          detail: profile.note ?? "This profile does not list its devices; check the project's own page.",
          href: link(device),
        };
      }
      const listed = profile.devices.includes(device.codename);
      return {
        supported: listed,
        detail: listed
          ? `Listed in this profile as supported.`
          : `Not listed in this profile. That may just mean the profile is out of date.`,
        href: link(device),
      };
    },

    async plan(device: DeviceRecord, _build: BuildInfo | null): Promise<Plan> {
      const reference = { label: `${profile.name} downloads`, href: link(device) };

      if (profile.engine === "factory-zip") {
        return buildFactoryPlan(device, {
          os: profile.name,
          reference,
          relock: profile.relock ?? false,
          artifacts: profile.artifacts ?? [
            { key: "factory", label: `${profile.name} factory image zip`, url: link(device) },
          ],
        });
      }

      const partition = device.recovery_partition_name ?? "recovery";
      return buildRecoveryPlan(device, {
        os: profile.name,
        reference,
        addons: true,
        artifacts: profile.artifacts ?? [
          { key: "rom", label: `${profile.name} zip`, url: link(device) },
          { key: "recovery", label: `Recovery image (${partition}.img)`, filename: `${partition}.img`, url: link(device) },
          ...(device.before_recovery_install?.partitions ?? []).map((p) => ({
            key: `img:${p}`,
            label: `${p}.img`,
            filename: `${p}.img`,
          })),
          { key: "addon", label: "Add-on package (optional)", optional: true },
        ],
      });
    },
  };
}

export async function loadProfiles(urls: string[]): Promise<Profile[]> {
  const profiles: Profile[] = [];
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      profiles.push((await response.json()) as Profile);
    } catch {
      // A missing profile is not worth failing the page over.
    }
  }
  return profiles;
}
