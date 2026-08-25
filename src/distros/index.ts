import type { Distro } from "../types";
import { lineageos } from "./lineageos";
import { calyxos, eos, grapheneos } from "./others";
import { loadProfiles, profileToDistro, type Profile } from "./generic";

const BUILTIN: Distro[] = [lineageos, eos, calyxos, grapheneos];

const PROFILE_URLS = ["profiles/iodeos.json", "profiles/divestos.json"];

export async function allDistros(): Promise<Distro[]> {
  const profiles = await loadProfiles(
    PROFILE_URLS.map((p) => new URL(p, document.baseURI).toString()),
  );
  return [...BUILTIN, ...profiles.map(profileToDistro)];
}

export { profileToDistro, type Profile };
