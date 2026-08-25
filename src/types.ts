// Shared data model.
//
// Two things meet in here: the *device* facts we generate from the LineageOS
// wiki, and the *plan* — the ordered list of steps that installing a given OS
// on a given device actually requires. Everything the UI renders is derived
// from a plan, so a new install method means writing a plan builder, not
// touching the UI.

/** Which USB personality the phone is currently presenting. */
export type Mode =
  /** Booted Android (or recovery) with USB debugging on: ADB protocol. */
  | "adb"
  /** Bootloader or fastbootd: fastboot protocol. */
  | "fastboot"
  /** Recovery, sitting in "Apply update from ADB": ADB, sideload service only. */
  | "sideload"
  /** Nothing usable is attached. */
  | "offline";

/** A device entry, generated from lineage_wiki `_data/devices/*.yml`. */
export interface DeviceRecord {
  id: string;
  codename: string;
  name: string;
  vendor: string;
  vendor_short?: string;
  type?: string;
  architecture: { cpu: string; userspace: string };
  current_branch?: number | string;
  versions?: (number | string)[];
  maintained: boolean;

  install_method?: string;
  custom_unlock_cmd?: string;
  no_oem_unlock_switch?: boolean;
  is_ab_device?: boolean;
  is_ab_rdap?: boolean;
  uses_twrp?: boolean;
  needs_fastboot_boot?: boolean;
  has_no_usb?: boolean;
  stock_is_not_android?: boolean;

  recovery_partition_name?: string;
  recovery_reboot?: string;
  recovery_boot?: string;
  download_boot?: string;

  before_install?: {
    instructions?: string;
    version?: string;
    ships_fw?: boolean;
  };
  before_recovery_install?: {
    instructions?: string;
    partitions?: string[];
    reboot_fastbootd?: boolean;
  };
  before_lineage_install?: string;

  custom_recovery_link?: string;
  custom_recovery_codename?: string;
  models?: string[];
  required_bootloader?: string[];
  image?: string;
  migrated_to?: string;
}

export interface DeviceDatabase {
  generated: string;
  source: { repo: string; commit: string };
  count: number;
  methods: Record<string, number>;
  devices: DeviceRecord[];
}

/**
 * An artefact the plan needs the user to supply — a ROM zip, a boot image, an
 * extra partition image. `sha256` comes from the OS project's own build
 * manifest where one is published; when we have it, a file that doesn't match
 * is refused rather than flashed.
 */
export interface Artifact {
  /** Stable key a step refers to, e.g. "rom", "boot", "img:dtbo". */
  key: string;
  /** What to call it in the UI. */
  label: string;
  /** Expected filename, when the project publishes a predictable one. */
  filename?: string;
  /** Where the user gets it. Opened in a new tab — never fetched by us. */
  url?: string;
  sha256?: string;
  size?: number;
  optional?: boolean;
  /** Free text shown under the drop target. */
  note?: string;
}

/** A resolved artefact: the user's file, checked against the manifest. */
export interface ResolvedArtifact {
  artifact: Artifact;
  file: File;
  sha256: string;
  status: "verified" | "unverified" | "mismatch";
}

/** One line of step prose. */
export type Body =
  | { text: string }
  | { code: string }
  | { warn: string }
  | { note: string }
  | { link: string; href: string };

export interface StepContext {
  device: DeviceRecord;
  /** Artefacts the user has supplied and we have hashed. */
  file(key: string): File;
  has(key: string): boolean;
  log(line: string, level?: "info" | "warn" | "error" | "ok"): void;
  /** 0..1, or null to clear. */
  progress(fraction: number | null, label?: string): void;
  fastboot(): Promise<import("./core/fastboot").FastbootSession>;
  adb(): Promise<import("./core/adb").AdbSession>;
  /** Block until the phone presents `mode`, prompting the user if needed. */
  awaitMode(mode: Mode, hint: string): Promise<void>;
}

export interface Step {
  id: string;
  title: string;
  body?: Body[];
  /** Host-tool equivalents, always shown. This is the fallback for browsers
   *  without WebUSB, and the audit trail for everyone else. */
  commands?: string[];
  /** Mode the phone must be in for `run` to work. */
  mode?: Mode;
  /** Steps that destroy data need an explicit, separate confirmation. */
  danger?: "wipe" | "unlock";
  /** Artefact keys this step consumes. */
  needs?: string[];
  /** Present for steps the browser performs itself. Absent means the human
   *  does it on the handset and ticks it off. */
  run?: (ctx: StepContext) => Promise<void>;
  /** Label for the manual acknowledgement button. */
  confirm?: string;
  optional?: boolean;
}

export interface Phase {
  id: string;
  title: string;
  summary?: string;
  steps: Step[];
}

export interface Plan {
  os: string;
  osVersion?: string;
  device: DeviceRecord;
  /** Set when the install method exists but this tool can't drive it. */
  unsupported?: string;
  /** Where the authoritative instructions live, always. */
  reference?: { label: string; href: string };
  artifacts: Artifact[];
  phases: Phase[];
}

/** An installable OS. Each one knows how to turn a device into a plan. */
export interface Distro {
  id: string;
  name: string;
  href: string;
  blurb: string;
  /** Codenames this OS builds for, or null if it can't be enumerated. */
  supports(device: DeviceRecord): Promise<Support>;
  plan(device: DeviceRecord, build: BuildInfo | null): Promise<Plan>;
  /** Fetch the newest build's manifest, if the project publishes one that is
   *  reachable from a browser (i.e. CORS-enabled). */
  builds?(device: DeviceRecord): Promise<BuildInfo[]>;
}

export interface Support {
  supported: boolean;
  /** "official" | "link-out only" | reason it isn't supported. */
  detail: string;
  href?: string;
}

export interface BuildInfo {
  version: string;
  date: string;
  files: Artifact[];
}
