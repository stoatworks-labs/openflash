// ADB over WebUSB.
//
// Used for two different jobs: reading properties off a booted phone (the
// autodetection that makes this tool worth using) and driving `sideload` in
// recovery. Recovery only offers the sideload service, so anything that shells
// out is guarded.

import { Adb, AdbDaemonTransport } from "@yume-chan/adb";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import { AdbDaemonWebUsbDeviceManager } from "@yume-chan/adb-daemon-webusb";

export interface AdbProps {
  device: string | null;
  model: string | null;
  manufacturer: string | null;
  androidVersion: string | null;
  securityPatch: string | null;
  bootloader: string | null;
  locked: boolean | null;
  /** True when the daemon is a recovery/sideload daemon, not a booted system. */
  recovery: boolean;
}

export class AdbSession {
  #alive = true;

  private constructor(
    readonly adb: Adb,
    /** Recovery daemons answer the handshake but have no shell and no getprop. */
    readonly recovery: boolean,
  ) {
    // The phone reboots several times during an install, and each reboot kills
    // the transport. Watching `disconnected` is how we know to re-open rather
    // than poking a dead one -- and it works in recovery, where there is no
    // shell to probe with.
    void this.adb.disconnected.then(() => { this.#alive = false; });
  }

  get alive(): boolean {
    return this.#alive;
  }

  static async open(): Promise<AdbSession> {
    const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
    if (!manager) throw new Error("This browser has no WebUSB.");

    // Reuse a device the user already granted, so we don't nag on every step.
    const known = await manager.getDevices();
    const device = known.length === 1 ? known[0]! : await manager.requestDevice();
    if (!device) throw new Error("No device was selected.");

    const connection = await device.connect();
    const transport = await AdbDaemonTransport.authenticate({
      serial: device.serial,
      connection,
      credentialStore: new AdbWebCredentialStore("openflash"),
    });

    const adb = new Adb(transport);
    // A booted system announces its product/model in the banner; recovery
    // announces almost nothing and has no shell. That's our mode test.
    const recovery = !transport.banner.model && !transport.banner.product;
    return new AdbSession(adb, recovery);
  }

  get serial(): string {
    return this.adb.serial;
  }

  /**
   * Read the properties we base decisions on. Returns nulls rather than
   * throwing when the daemon is a recovery one: a missing value is a fact the
   * plan can work with, an exception is not.
   */
  async props(): Promise<AdbProps> {
    const banner = this.adb.banner;
    const empty: AdbProps = {
      device: banner.device ?? null,
      model: banner.model ?? null,
      manufacturer: null,
      androidVersion: null,
      securityPatch: null,
      bootloader: null,
      locked: null,
      recovery: this.recovery,
    };
    if (this.recovery) return empty;

    const get = async (key: string): Promise<string | null> => {
      try {
        const value = (await this.adb.getProp(key)).trim();
        return value.length > 0 ? value : null;
      } catch {
        return null;
      }
    };

    // `ro.boot.flash.locked` is 1 when the bootloader is locked. Not every
    // device sets it, hence the tri-state.
    const flashLocked = await get("ro.boot.flash.locked");

    return {
      ...empty,
      device: (await get("ro.product.device")) ?? empty.device,
      model: (await get("ro.product.model")) ?? empty.model,
      manufacturer: await get("ro.product.manufacturer"),
      androidVersion: await get("ro.build.version.release"),
      securityPatch: await get("ro.build.version.security_patch"),
      bootloader: await get("ro.bootloader"),
      locked: flashLocked === "1" ? true : flashLocked === "0" ? false : null,
    };
  }

  /** `adb reboot bootloader` and friends. */
  async reboot(target: "" | "bootloader" | "recovery" | "sideload" | "fastboot" = ""): Promise<void> {
    // AdbPower covers the common targets; the raw service call covers the rest
    // and behaves identically from the daemon's point of view.
    await this.adb.createSocketAndWait(target ? `reboot:${target}` : "reboot:");
  }

  async close(): Promise<void> {
    this.#alive = false;
    try {
      await this.adb.close();
    } catch {
      // The phone rebooting out from under us is the normal way this ends.
    }
  }
}
