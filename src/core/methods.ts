// What each of the wiki's 28 `install_method` values means for us.
//
// The important distinction is not "fastboot or not" — it's whether the
// bootloader can be unlocked by a command we can send. On a Pixel it can. On a
// Xiaomi it cannot: you need Mi Unlock, an account, and a waiting period that
// can run to a week. Pretending otherwise would send people into a dead end at
// the exact point where the next wrong move wipes their phone, so every method
// that needs a vendor portal says so and links to it.

export type Engine =
  /** fastboot a recovery on, then sideload the ROM zip from it. */
  | "recovery-sideload"
  /** `fastboot update` an AOSP factory-image zip. */
  | "factory-zip"
  /** We cannot drive this from a browser at all. */
  | "unsupported";

export interface UnlockRoute {
  /** `fastboot flashing unlock` (or the device's own variant) just works. */
  kind: "fastboot" | "vendor-portal" | "none";
  portal?: { name: string; href: string };
  note?: string;
}

export interface MethodInfo {
  engine: Engine;
  unlock: UnlockRoute;
  /** Shown when engine is "unsupported". */
  why?: string;
}

const FASTBOOT_UNLOCK: UnlockRoute = { kind: "fastboot" };

const METHODS: Record<string, MethodInfo> = {
  // Google-style: unlock is a fastboot command, recovery goes on a partition.
  fastboot_nexus: { engine: "recovery-sideload", unlock: FASTBOOT_UNLOCK },
  fastboot_generic: { engine: "recovery-sideload", unlock: FASTBOOT_UNLOCK },
  fastboot_custom: { engine: "recovery-sideload", unlock: FASTBOOT_UNLOCK },
  fastboot_fairphone: { engine: "recovery-sideload", unlock: FASTBOOT_UNLOCK },
  fastboot_lenovo: { engine: "recovery-sideload", unlock: FASTBOOT_UNLOCK },
  fastboot_nubia: { engine: "recovery-sideload", unlock: FASTBOOT_UNLOCK },
  fastboot_zenfone: { engine: "recovery-sideload", unlock: FASTBOOT_UNLOCK },
  fastboot_zte: { engine: "recovery-sideload", unlock: FASTBOOT_UNLOCK },

  // Already unlocked, or unlockable without a command.
  fastboot_unlocked: {
    engine: "recovery-sideload",
    unlock: { kind: "none", note: "This device ships unlocked, or was unlocked before you got it." },
  },

  // Unlock requires an account, a token, or a wait. We flash, we do not unlock.
  fastboot_xiaomi: {
    engine: "recovery-sideload",
    unlock: {
      kind: "vendor-portal",
      portal: { name: "Mi Unlock", href: "https://en.miui.com/unlock/" },
      note:
        "Xiaomi unlocking runs through their Windows-only Mi Unlock tool and a Mi " +
        "account bound to the phone, and the account must usually wait 7 days (on " +
        "recent HyperOS builds, considerably longer) before the unlock is granted. " +
        "Start that first — everything below is blocked until it completes.",
    },
  },
  fastboot_xiaomi_hyperos: {
    engine: "recovery-sideload",
    unlock: {
      kind: "vendor-portal",
      portal: { name: "Mi Unlock", href: "https://en.miui.com/unlock/" },
      note:
        "HyperOS adds a community-participation requirement on top of the Mi Unlock " +
        "wait, and the unlock window is time-limited once granted. Read Xiaomi's " +
        "current terms before starting; they change often.",
    },
  },
  fastboot_motorola: {
    engine: "recovery-sideload",
    unlock: {
      kind: "vendor-portal",
      portal: { name: "Motorola bootloader unlock", href: "https://en-us.support.motorola.com/app/standalone/bootloader/unlock-your-device-a" },
      note:
        "Motorola issues a per-device unlock code by email after you paste in the " +
        "output of `fastboot oem get_unlock_data`. Some carrier models are " +
        "permanently ineligible. Motorola has also wound this programme down for " +
        "newer devices — check yours is listed before you plan around it.",
    },
  },
  fastboot_sony: {
    engine: "recovery-sideload",
    unlock: {
      kind: "vendor-portal",
      portal: { name: "Sony Open Devices unlock", href: "https://developer.sony.com/open-source/aosp-on-xperia-open-devices/get-started/unlock-bootloader" },
      note:
        "Sony issues an unlock key against your IMEI. Unlocking irreversibly erases " +
        "the DRM keys, which costs you some camera processing quality on many Xperias.",
    },
  },
  fastboot_lg: {
    engine: "recovery-sideload",
    unlock: {
      kind: "vendor-portal",
      portal: { name: "LG Developer (retired)", href: "https://developer.lge.com/" },
      note:
        "LG's unlock portal is retired along with the phone division. If you do not " +
        "already hold an unlock.bin for this handset, there is no longer an official " +
        "route to one.",
    },
  },
  fastboot_htc: {
    engine: "recovery-sideload",
    unlock: {
      kind: "vendor-portal",
      portal: { name: "HTCdev", href: "https://www.htcdev.com/bootloader" },
      note: "HTCdev issues an Unlock_code.bin against a token from your device.",
    },
  },
  fastboot_huawei: {
    engine: "recovery-sideload",
    unlock: {
      kind: "vendor-portal",
      portal: { name: "Huawei (discontinued)", href: "https://consumer.huawei.com/en/support/unlock/" },
      note:
        "Huawei stopped issuing unlock codes in 2018. Without a code obtained before " +
        "then, these devices cannot be unlocked by any supported means.",
    },
  },
  fastboot_oneplus_tmo: {
    engine: "recovery-sideload",
    unlock: {
      kind: "vendor-portal",
      portal: { name: "T-Mobile device unlock", href: "https://www.t-mobile.com/support/devices/unlock-your-mobile-wireless-device" },
      note:
        "T-Mobile OnePlus models need a carrier SIM-unlock and then a separate " +
        "bootloader unlock token from OnePlus before `fastboot` will accept anything.",
    },
  },
  fastboot_oppo: { engine: "recovery-sideload", unlock: { kind: "vendor-portal", portal: { name: "OPPO in-depth test", href: "https://www.oppo.com/en/" }, note: "OPPO unlocking uses their 'in-depth test' app and an approval that can take days." } },
  fastboot_realme: { engine: "recovery-sideload", unlock: { kind: "vendor-portal", portal: { name: "realme Deep Testing", href: "https://www.realme.com/" }, note: "realme unlocking uses their Deep Testing app and a per-device approval." } },
  fastboot_realme_china: { engine: "recovery-sideload", unlock: { kind: "vendor-portal", portal: { name: "realme Deep Testing (CN)", href: "https://www.realme.com/cn/" }, note: "Chinese-market realme unlocking uses a separate, Chinese-language tool." } },
  fastboot_nokia: { engine: "recovery-sideload", unlock: { kind: "vendor-portal", portal: { name: "HMD (unofficial)", href: "https://www.hmd.com/" }, note: "HMD never ran a general unlock programme; most Nokia-branded devices depend on third-party services of varying legitimacy." } },

  // Not fastboot at all, and not something a browser can host.
  samloader_rs: {
    engine: "unsupported",
    unlock: { kind: "none" },
    why:
      "Samsung devices flash over Odin, not fastboot, and the stock firmware must be " +
      "fetched from Samsung's own servers with samloader. WebUSB cannot speak Odin, " +
      "and the download needs credentials this page does not have.",
  },
  dd: {
    engine: "unsupported",
    unlock: { kind: "none" },
    why: "This device is installed by writing partitions from a shell on the device itself (`dd`), which needs a root shell rather than a flashing protocol.",
  },
  apx: {
    engine: "unsupported",
    unlock: { kind: "none" },
    why: "NVIDIA Tegra APX/RCM mode needs nvflash or fusee-style tooling and a driver stack that WebUSB cannot reach.",
  },
  edl_custom: {
    engine: "unsupported",
    unlock: { kind: "none" },
    why: "Qualcomm Emergency Download mode needs signed programmer binaries and a Sahara/Firehose implementation, which is well outside what this tool does.",
  },
  nintendo: {
    engine: "unsupported",
    unlock: { kind: "none" },
    why: "Nintendo Switch installs run from a payload injected over RCM or a modchip; nothing here applies.",
  },
  amlogic_update: {
    engine: "unsupported",
    unlock: { kind: "none" },
    why: "Amlogic boxes use the vendor's USB Burning Tool, a Windows-only protocol.",
  },
  oor: {
    engine: "unsupported",
    unlock: { kind: "none" },
    why: "This device installs from a vendor-specific out-of-recovery flow the wiki documents by hand.",
  },
};

export function methodInfo(method: string | undefined): MethodInfo {
  if (!method) {
    return {
      engine: "unsupported",
      unlock: { kind: "none" },
      why: "The wiki lists no install method for this device, which usually means it was discontinued before one was written down.",
    };
  }
  return (
    METHODS[method] ?? {
      engine: "recovery-sideload",
      unlock: {
        kind: "fastboot",
        note: `This device's install method (\`${method}\`) has no specific entry here, so the generic fastboot procedure is shown. Check it against the wiki before running it.`,
      },
    }
  );
}
