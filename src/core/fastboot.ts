// Fastboot over WebUSB, wrapped so the rest of the app never touches the
// library directly.

import { FastbootDevice, FastbootError, UsbError } from "android-fastboot";

export interface FastbootVars {
  product: string | null;
  serialno: string | null;
  unlocked: string | null;
  "secure": string | null;
  "current-slot": string | null;
  "slot-count": string | null;
  "is-userspace": string | null;
  "version-bootloader": string | null;
  "max-download-size": string | null;
}

const PROBE_VARS = [
  "product", "serialno", "unlocked", "secure", "current-slot", "slot-count",
  "is-userspace", "version-bootloader", "max-download-size",
] as const;

export class FastbootSession {
  private constructor(readonly dev: FastbootDevice) {}

  /**
   * Prompt for (or reuse) a fastboot device and claim it.
   *
   * The library's `connect()` reuses an already-paired device when exactly one
   * is paired, and otherwise raises the browser's device chooser — which is
   * why this must be called from a user gesture.
   */
  static async open(): Promise<FastbootSession> {
    const dev = new FastbootDevice();
    await dev.connect();
    return new FastbootSession(dev);
  }

  get connected(): boolean {
    return this.dev.isConnected;
  }

  async getvar(name: string): Promise<string | null> {
    try {
      return await this.dev.getVariable(name);
    } catch {
      // Bootloaders disagree about how to report an unknown variable: some
      // return an empty OKAY, some FAIL, some just hang up. None of those mean
      // anything worse than "this device doesn't have that variable".
      return null;
    }
  }

  /** Read everything we use for autodetection in one go. */
  async probe(): Promise<FastbootVars> {
    const out = {} as Record<string, string | null>;
    for (const name of PROBE_VARS) out[name] = await this.getvar(name);
    return out as unknown as FastbootVars;
  }

  /**
   * Is the bootloader unlocked? Devices report this in one of two variables and
   * some report neither, so `null` genuinely means "can't tell" and callers
   * should fall back to asking the user rather than guessing.
   */
  async unlocked(): Promise<boolean | null> {
    const unlocked = await this.getvar("unlocked");
    if (unlocked === "yes") return true;
    if (unlocked === "no") return false;
    const secure = await this.getvar("secure");
    if (secure === "no") return true;
    if (secure === "yes") return false;
    return null;
  }

  async command(cmd: string): Promise<string> {
    return (await this.dev.runCommand(cmd)).text;
  }

  async flash(
    partition: string,
    blob: Blob,
    onProgress?: (fraction: number) => void,
  ): Promise<void> {
    await this.dev.flashBlob(partition, blob, onProgress);
  }

  async bootOnce(blob: Blob, onProgress?: (f: number) => void): Promise<void> {
    await this.dev.bootBlob(blob, onProgress);
  }

  /** `fastboot update <zip>` — the AOSP factory-image path. */
  async flashFactoryZip(
    blob: Blob,
    wipe: boolean,
    onReconnect: () => void,
    onProgress?: (action: string, item: string, fraction: number) => void,
  ): Promise<void> {
    await this.dev.flashFactoryZip(blob, wipe, onReconnect, onProgress);
  }

  /** target: "" (to system), "bootloader", "fastboot" (fastbootd), "recovery". */
  async reboot(target = "", wait = false, onReconnect?: () => void): Promise<void> {
    await this.dev.reboot(target, wait, onReconnect);
  }

  async waitForDisconnect(): Promise<void> {
    await this.dev.waitForDisconnect();
  }
}

/** Turn a library error into something worth showing a person. */
export function describeFastbootError(err: unknown): string {
  if (err instanceof FastbootError) {
    return `bootloader refused the command: ${err.message}`;
  }
  if (err instanceof UsbError) {
    return `USB problem: ${err.message}. Try a different cable or a USB 2.0 port — ` +
      `bootloader-mode USB is notoriously fussy, especially through hubs and USB-C docks.`;
  }
  if (err instanceof Error) {
    if (err.name === "NotFoundError") return "No device was selected.";
    if (err.name === "SecurityError") return "The browser blocked USB access.";
    return err.message;
  }
  return String(err);
}
