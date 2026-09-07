import type { Distro } from "../types";
import { lineageos } from "./lineageos";
import { calyxos, eos, grapheneos } from "./others";
import { other } from "./other";
import { loadProfiles, profileToDistro, type Profile } from "./generic";

const BUILTIN: Distro[] = [lineageos, eos, calyxos, grapheneos];

const PROFILE_URLS = ["profiles/iodeos.json", "profiles/divestos.json"];

export async function allDistros(): Promise<Distro[]> {
  const profiles = await loadProfiles(
    PROFILE_URLS.map((p) => new URL(p, document.baseURI).toString()),
  );
  // The catch-all goes last: it is the answer when nothing above fits.
  return [...BUILTIN, ...profiles.map(profileToDistro), other];
}

export { profileToDistro, type Profile };
