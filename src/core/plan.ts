// Turning a device record into an ordered, executable procedure.
//
// The LineageOS wiki generates its install pages from the same device data we
// consume, so this file is essentially that Liquid template re-expressed as
// steps a machine can run. Where the wiki says "type this command", we either
// run it over WebUSB or — when it is something only a human standing over the
// handset can do, like holding Volume Down or picking "Format data" out of a
// recovery menu — we print it and wait to be told it is done.
//
// Every step carries its host-tool equivalent regardless. That is what makes
// the page useful in Firefox, and it is what lets someone check what we are
// about to do to their phone before they let us do it.

import type {
  Artifact, Body, DeviceRecord, Phase, Plan, Step,
} from "../types";
import { parseUnlockCommand } from "./unlock";
import { methodInfo } from "./methods";
import { sideload } from "./sideload";

export interface RecoveryPlanOptions {
  os: string;
  osVersion?: string;
  reference?: { label: string; href: string };
  artifacts: Artifact[];
  /** Whether the OS publishes optional add-on packages (GApps and friends). */
  addons?: boolean;
}

const text = (s: string): Body => ({ text: s });
const warn = (s: string): Body => ({ warn: s });
const note = (s: string): Body => ({ note: s });

/** The partition the recovery image goes on; `boot` on modern A/B devices. */
const recoveryPartition = (d: DeviceRecord) => d.recovery_partition_name ?? "recovery";

/**
 * Build the recovery-and-sideload procedure: unlock the bootloader, put a
 * recovery on the device with fastboot, then push the ROM zip into it with
 * `adb sideload`. This covers the whole `fastboot_*` family — roughly 500 of
 * the 733 devices in the database.
 */
export function buildRecoveryPlan(
  device: DeviceRecord,
  options: RecoveryPlanOptions,
): Plan {
  const method = methodInfo(device.install_method);
  const partition = recoveryPartition(device);
  const phases: Phase[] = [];

  if (method.engine === "unsupported") {
    return {
      os: options.os,
      osVersion: options.osVersion,
      device,
      unsupported: method.why,
      reference: options.reference,
      artifacts: [],
      phases: [],
    };
  }

  // ---------------------------------------------------------------- prepare
  const prepare: Step[] = [
    {
      id: "read-first",
      title: "Read the whole procedure before starting anything",
      body: [
        text(
          `This will erase everything on the ${device.name}. Not "erase apps" — ` +
            `erase, including internal storage, twice over.`,
        ),
        text(
          "Back up anything you want to keep to a computer now. Cloud backups of a " +
            "stock ROM often will not restore onto a custom one.",
        ),
        warn(
          "If any step fails, stop. Do not carry on to the next one. A half-flashed " +
            "phone is usually recoverable; a phone that has had three more steps run " +
            "on top of a failure often is not.",
        ),
      ],
      confirm: "I have read it through and backed up",
    },
    {
      id: "frp",
      title: "Remove your Google account from the device",
      body: [
        text(
          "Settings, Accounts, remove every Google account. Skipping this leaves " +
            "Factory Reset Protection armed, and after the wipe the phone will demand " +
            "the credentials of an account that no longer matches anything on it.",
        ),
      ],
      confirm: "Accounts removed",
    },
    {
      id: "usb-debugging",
      title: "Enable developer options and USB debugging",
      body: [
        text(
          "Settings, About phone, tap Build number seven times. Then Settings, " +
            "System, Developer options, and turn on USB debugging.",
        ),
        ...(device.no_oem_unlock_switch
          ? []
          : [
              text(
                "In the same screen, turn on OEM unlocking. If it is greyed out, the " +
                  "phone is either carrier-locked or has not been online long enough " +
                  "to check in — connect it to the internet and try again later.",
              ),
            ]),
      ],
      commands: ["adb devices"],
      confirm: "USB debugging is on",
    },
    {
      id: "probe",
      title: "Identify the connected device",
      body: [
        text(
          "Connect the phone by USB and let this page read its model, Android " +
            "version and lock state, so the rest of the procedure can be checked " +
            "against the device actually in front of you.",
        ),
        note(
          "Your phone will show an 'Allow USB debugging' prompt with a fingerprint. " +
            "Accept it. That key is generated in this browser and stored locally.",
        ),
      ],
      commands: [
        "adb devices -l",
        "adb -d shell getprop ro.product.device",
        "adb -d shell getprop ro.build.version.release",
      ],
      mode: "adb",
      run: async (ctx) => {
        const adb = await ctx.adb();
        const props = await adb.props();
        ctx.log(`serial: ${adb.serial}`);
        ctx.log(`codename: ${props.device ?? "unknown"}`);
        ctx.log(`model: ${props.model ?? "unknown"}`);
        ctx.log(`android: ${props.androidVersion ?? "unknown"}`);
        ctx.log(`patch level: ${props.securityPatch ?? "unknown"}`);
        ctx.log(`bootloader: ${props.bootloader ?? "unknown"}`);

        if (props.device && props.device !== ctx.device.codename) {
          throw new Error(
            `This phone reports its codename as "${props.device}", but the selected ` +
              `procedure is for "${ctx.device.codename}". Flashing one device's build ` +
              `onto another is how phones get bricked. Go back and pick ${props.device}.`,
          );
        }
        if (props.device) ctx.log(`codename matches ${ctx.device.codename}`, "ok");

        const required = ctx.device.before_install?.version;
        if (required && props.androidVersion) {
          const major = props.androidVersion.split(".")[0];
          if (major !== required) {
            ctx.log(
              `This build needs stock Android ${required}; the phone is on ` +
                `${props.androidVersion}. See the firmware step below.`,
              "warn",
            );
          } else {
            ctx.log(`stock firmware is Android ${required}, as required`, "ok");
          }
        }
        if (props.locked === false) ctx.log("bootloader is already unlocked", "ok");
      },
    },
  ];

  if (device.before_install?.instructions === "needs_specific_android_fw") {
    const version = device.before_install.version;
    prepare.splice(1, 0, {
      id: "firmware",
      title: version
        ? `The phone must be on stock Android ${version} first`
        : "The phone must be on a specific stock firmware first",
      body: [
        warn(
          version
            ? `${options.os} builds for the ${device.name} expect the vendor firmware ` +
                `that ships with stock Android ${version}. This is a firmware ` +
                `requirement, not a version number to match — it is normal for it to ` +
                `be older than the ${options.os} release you are installing.`
            : `This device needs a particular stock firmware version installed before ` +
                `${options.os} will work.`,
        ),
        text(
          "Being on another custom ROM proves nothing about which firmware is " +
            "underneath. If you are not certain, go back to stock first.",
        ),
        warn(
          "Getting this wrong ranges from an install that fails, through a phone " +
            "that boots but has no modem, to permanent damage.",
        ),
      ],
      confirm: version ? `The phone is on stock Android ${version}` : "Firmware confirmed",
    });
  }

  if (device.models?.length) {
    prepare.splice(1, 0, {
      id: "model",
      title: "Check the model number is one of the supported ones",
      body: [
        text("Settings, About phone, Model. It must match exactly:"),
        ...device.models.map((m) => ({ code: m })),
        warn(
          "Near-identical model numbers are frequently different hardware. An exact " +
            "match is the requirement, not a close one.",
        ),
      ],
      confirm: "Model number matches",
    });
  }

  if (device.required_bootloader?.length) {
    prepare.push({
      id: "bootloader-version",
      title: `Bootloader must be ${device.required_bootloader.join(" or ")}`,
      body: [text("Check with:")],
      commands: ["adb -d shell getprop ro.bootloader"],
      confirm: "Bootloader version matches",
    });
  }

  phases.push({
    id: "prepare",
    title: "Before you start",
    summary: "Checks that are cheap now and expensive to have skipped.",
    steps: prepare,
  });

  // ----------------------------------------------------------------- unlock
  const unlockSteps: Step[] = [];

  if (method.unlock.kind === "vendor-portal") {
    unlockSteps.push({
      id: "vendor-unlock",
      title: `${device.vendor} controls unlocking on this device`,
      body: [
        warn(method.unlock.note ?? "This device's bootloader is unlocked through the vendor, not by a fastboot command."),
        ...(method.unlock.portal
          ? [{ link: method.unlock.portal.name, href: method.unlock.portal.href } as Body]
          : []),
        text(
          "This page cannot do that part for you. Come back once the bootloader is " +
            "actually unlocked — the next step will verify it rather than take your " +
            "word for it.",
        ),
      ],
      confirm: "The bootloader is unlocked",
    });
  }

  unlockSteps.push({
    id: "to-bootloader",
    title: "Reboot into the bootloader",
    body: [
      text(
        device.download_boot
          ? `Either let this page reboot the phone, or do it by hand: ${device.download_boot}`
          : "Either let this page reboot the phone, or power it off and use its bootloader key combination.",
      ),
    ],
    commands: ["adb -d reboot bootloader", "fastboot devices"],
    mode: "adb",
    run: async (ctx) => {
      const adb = await ctx.adb();
      ctx.log("rebooting to bootloader");
      await adb.reboot("bootloader");
      await adb.close();
    },
    confirm: "The phone is in the bootloader",
  });

  unlockSteps.push({
    id: "fastboot-connect",
    title: "Connect to the bootloader",
    body: [
      text("Read the bootloader's own view of the device: product, slot, and lock state."),
      note(
        "Bootloader-mode USB is much fussier than normal-mode USB. If this fails, " +
          "try a different cable, a USB 2.0 port, and no hub or dock in between.",
      ),
    ],
    commands: ["fastboot devices", "fastboot getvar product", "fastboot getvar unlocked"],
    mode: "fastboot",
    run: async (ctx) => {
      const fb = await ctx.fastboot();
      const vars = await fb.probe();
      ctx.log(`product: ${vars.product ?? "unknown"}`);
      ctx.log(`serial: ${vars.serialno ?? "unknown"}`);
      ctx.log(`bootloader: ${vars["version-bootloader"] ?? "unknown"}`);
      if (vars["slot-count"]) {
        ctx.log(`slots: ${vars["slot-count"]}, current ${vars["current-slot"] ?? "?"}`);
      }

      // `product` is the bootloader's name for the board. It usually equals the
      // codename but not always, so a mismatch is a warning, not a hard stop --
      // unlike the ADB codename check, which is authoritative.
      if (vars.product && vars.product !== ctx.device.codename) {
        ctx.log(
          `bootloader reports product "${vars.product}", expected "${ctx.device.codename}". ` +
            `Some vendors use a different name here; if you are sure this is a ` +
            `${ctx.device.name}, carry on, otherwise stop.`,
          "warn",
        );
      }

      const unlocked = await fb.unlocked();
      if (unlocked === true) ctx.log("bootloader is unlocked", "ok");
      else if (unlocked === false) ctx.log("bootloader is locked", "warn");
      else ctx.log("this bootloader does not report its lock state", "warn");
    },
  });

  if (method.unlock.kind === "fastboot") {
    const cmd = device.custom_unlock_cmd ?? "fastboot oem unlock";
    unlockSteps.push({
      id: "unlock",
      title: "Unlock the bootloader",
      danger: "wipe",
      body: [
        warn("This erases the entire device. It is the point of no return for your data."),
        text(
          "The phone will then show its own confirmation screen. Answer it with the " +
            "volume keys to move and power to select — this page cannot press it for you.",
        ),
        ...(device.no_oem_unlock_switch
          ? []
          : [note("If this is refused, OEM unlocking is still off in Developer options.")]),
      ],
      commands: [cmd],
      mode: "fastboot",
      run: async (ctx) => {
        const fb = await ctx.fastboot();
        if ((await fb.unlocked()) === true) {
          ctx.log("already unlocked, nothing to do", "ok");
          return;
        }
        for (const op of parseUnlockCommand(cmd)) {
          if (op.kind === "reboot") {
            ctx.log(`rebooting to ${op.target || "system"}`);
            await fb.reboot(op.target);
            continue;
          }
          ctx.log(`sending: ${op.text}`);
          try {
            const reply = await fb.command(op.text);
            if (reply) ctx.log(reply);
          } catch (err) {
            ctx.log(
              `the bootloader did not accept it cleanly: ${(err as Error).message}. ` +
                `If the phone is showing a confirmation screen, answer it, then re-run ` +
                `this step to check the result.`,
              "warn",
            );
          }
        }
      },
      confirm: "The phone confirms it is unlocked",
    });

    unlockSteps.push({
      id: "post-unlock",
      title: "Let it wipe and reboot, then re-enable USB debugging",
      body: [
        text(
          "Unlocking factory-resets the phone, so the developer options you turned " +
            "on earlier are gone. Boot it up, skip through setup, and turn on " +
            "Developer options and USB debugging again.",
        ),
        text(
          device.download_boot
            ? `Then go back to the bootloader: ${device.download_boot}`
            : "Then go back to the bootloader.",
        ),
      ],
      commands: ["adb -d reboot bootloader"],
      confirm: "Back in the bootloader",
    });
  }

  phases.push({
    id: "unlock",
    title: "Unlock the bootloader",
    summary:
      method.unlock.kind === "vendor-portal"
        ? `Unlocking a ${device.vendor} device goes through ${device.vendor}, not through this page.`
        : "Only needs doing once per device, and destroys all data on it.",
    steps: unlockSteps,
  });

  // --------------------------------------------------------------- recovery
  const recoverySteps: Step[] = [];

  if (device.is_ab_rdap) {
    recoverySteps.push({
      id: "wipe-super",
      title: "Wipe the super partition",
      body: [
        text(
          "This device retrofits dynamic partitions, so the existing super partition " +
            "layout has to be cleared before the new one can be written.",
        ),
      ],
      commands: ["fastboot wipe-super --slot=all super_empty.img"],
      needs: ["super_empty"],
      mode: "fastboot",
      run: async (ctx) => {
        const fb = await ctx.fastboot();
        ctx.log("flashing super_empty.img to super");
        await fb.flash("super", ctx.file("super_empty"), (f) => ctx.progress(f, "super"));
        ctx.progress(null);
      },
    });
  }

  const extras = device.before_recovery_install?.partitions ?? [];
  if (extras.length > 0) {
    if (device.before_recovery_install?.reboot_fastbootd) {
      recoverySteps.push({
        id: "to-fastbootd",
        title: "Reboot into fastbootd",
        body: [
          text(
            "These partitions live in userspace fastboot, which is a second, " +
              "Android-based fastboot the phone boots into on request.",
          ),
        ],
        commands: ["fastboot reboot fastboot"],
        mode: "fastboot",
        run: async (ctx) => {
          const fb = await ctx.fastboot();
          await fb.reboot("fastboot");
          ctx.log("rebooting into fastbootd; reconnect when it comes back");
        },
        confirm: "fastbootd is up",
      });
    }

    recoverySteps.push({
      id: "extra-partitions",
      title: `Flash the extra partitions this platform needs (${extras.join(", ")})`,
      body: [
        warn(
          "Recovery will not work properly on this device until these are flashed. " +
            "They come from the same build as the ROM — do not mix builds.",
        ),
      ],
      commands: extras.map((p) => `fastboot flash ${p} ${p}.img`),
      needs: extras.map((p) => `img:${p}`),
      mode: "fastboot",
      run: async (ctx) => {
        const fb = await ctx.fastboot();
        for (const p of extras) {
          ctx.log(`flashing ${p}`);
          await fb.flash(p, ctx.file(`img:${p}`), (f) => ctx.progress(f, p));
          ctx.log(`${p} flashed`, "ok");
        }
        ctx.progress(null);
      },
    });

    recoverySteps.push({
      id: "reboot-bootloader",
      title: "Reboot back into the bootloader",
      commands: ["fastboot reboot bootloader"],
      mode: "fastboot",
      run: async (ctx) => {
        const fb = await ctx.fastboot();
        await fb.reboot("bootloader");
        ctx.log("rebooting the bootloader");
      },
      confirm: "Back in the bootloader",
    });
  }

  if (device.needs_fastboot_boot) {
    recoverySteps.push({
      id: "boot-recovery",
      title: "Boot the recovery image without installing it",
      body: [
        text(
          "This device runs the recovery straight from memory rather than having it " +
            "flashed, so nothing is written to the phone by this step.",
        ),
      ],
      commands: [`fastboot boot ${partition}.img`],
      needs: ["recovery"],
      mode: "fastboot",
      run: async (ctx) => {
        const fb = await ctx.fastboot();
        ctx.log("uploading and booting the recovery image");
        await fb.bootOnce(ctx.file("recovery"), (f) => ctx.progress(f, "recovery"));
        ctx.progress(null);
      },
      confirm: "Recovery is on screen",
    });
  } else {
    recoverySteps.push({
      id: "flash-recovery",
      title: `Flash the recovery image to the ${partition} partition`,
      body: [
        ...(partition === "boot"
          ? [
              note(
                "On this device the recovery lives in the boot partition — that is " +
                  "correct, not a mistake in these instructions.",
              ),
            ]
          : []),
        warn(
          device.uses_twrp
            ? "Use the recovery linked for this device. Other builds of TWRP frequently fail to install or update the ROM."
            : "Use the recovery published alongside this build. Other recoveries frequently fail to install or update the ROM.",
        ),
      ],
      commands: [`fastboot flash ${partition} ${partition}.img`],
      needs: ["recovery"],
      mode: "fastboot",
      run: async (ctx) => {
        const fb = await ctx.fastboot();
        ctx.log(`flashing recovery to ${partition}`);
        await fb.flash(partition, ctx.file("recovery"), (f) => ctx.progress(f, partition));
        ctx.progress(null);
        ctx.log("recovery flashed", "ok");
      },
    });

    recoverySteps.push(rebootToRecoveryStep(device, options.os));
  }

  phases.push({
    id: "recovery",
    title: "Install the recovery",
    summary: "Everything from here happens through the recovery, not the bootloader.",
    steps: recoverySteps,
  });

  // ---------------------------------------------------------------- install
  const installSteps: Step[] = [];

  installSteps.push({
    id: "format-data",
    title: "Format data",
    danger: "wipe",
    body: [
      text(
        device.uses_twrp
          ? "In TWRP: Wipe, then Format Data, and confirm."
          : "In the recovery menu: Factory Reset, then Format data / factory reset, and confirm.",
      ),
      text(
        "This removes the existing encryption as well as the files. Skipping it " +
          "leaves the new system unable to read the data partition, which shows up " +
          "as a boot loop.",
      ),
      note(
        "Touch works in most recoveries. If it does not, volume keys move and power selects.",
      ),
    ],
    confirm: "Data formatted",
  });

  if (device.before_lineage_install === "ab_copy_partitions") {
    installSteps.push({
      id: "copy-partitions",
      title: "Copy firmware to the inactive slot",
      body: [
        text(
          "This is an A/B device, and its second slot may hold much older firmware " +
            "than the one you have been running — or none at all.",
        ),
        warn(
          "Installing over an unpopulated slot on this device can hard-brick it. " +
            "This step copies the active slot over the inactive one first.",
        ),
        note("The copy-partitions package is by LineageOS developers erfanoabdi and filipepferraz."),
      ],
      commands: [
        "adb -d sideload copy-partitions-20220613-signed.zip",
      ],
      needs: ["copy-partitions"],
      mode: "sideload",
      run: async (ctx) => {
        const adb = await ctx.adb();
        ctx.log("sideloading copy-partitions");
        await sideload(adb, ctx.file("copy-partitions"), {
          onProgress: (f) => ctx.progress(f, "copy-partitions"),
          onLog: (l) => ctx.log(l),
        });
        ctx.progress(null);
        ctx.log("copy-partitions done; reboot to recovery again before continuing", "ok");
      },
      confirm: "Rebooted back to recovery",
    });
  }

  installSteps.push({
    id: "sideload-rom",
    title: `Sideload ${options.os}`,
    body: [
      text(
        device.uses_twrp
          ? 'On the phone: Advanced, ADB Sideload, then swipe to start.'
          : 'On the phone: Apply update, then Apply from ADB.',
      ),
      warn("Do not reboot to the system when this finishes if you intend to install add-ons."),
      note(
        "A successful sideload sometimes stops at 47% and prints an error like " +
          '"adb: failed to read command: Success". That is the known cosmetic ending, ' +
          "not a failure.",
      ),
      note(
        'If this fails with "the device is already in used by another program", a ' +
          "local adb server has claimed the phone. Run `adb kill-server` and try " +
          "again — recovery re-enumerates as a new USB device, which is exactly the " +
          "moment a running adb server grabs it.",
      ),
    ],
    commands: ["adb -d sideload /path/to/rom.zip"],
    needs: ["rom"],
    mode: "sideload",
    run: async (ctx) => {
      const adb = await ctx.adb();
      const file = ctx.file("rom");
      ctx.log(`sideloading ${file.name}`);
      await sideload(adb, file, {
        onProgress: (f) => ctx.progress(f, "sideload"),
        onLog: (l) => ctx.log(l),
      });
      ctx.progress(null);
      ctx.log("ROM installed", "ok");
    },
  });

  if (options.addons !== false) {
    installSteps.push({
      id: "addons",
      title: "Install add-ons (optional)",
      optional: true,
      body: [
        text(
          `Add-ons such as Google Apps must go on now, before the first boot. The ` +
            `${device.architecture.userspace} packages are the ones for this device.`,
        ),
        ...(device.is_ab_device
          ? [
              note(
                "On A/B devices the recovery usually offers to reboot back into " +
                  "recovery after the ROM install specifically so add-ons can be " +
                  "applied. Say yes to that.",
              ),
            ]
          : []),
        note(
          'Add-ons are not signed with the OS project\'s key, so recovery will say ' +
            '"Signature verification failed". Answering Yes is expected here.',
        ),
        note(
          "This step follows a reboot back into recovery, which is where a local adb " +
            "server is most likely to have taken the device. If it reports that " +
            "something else is using it, run `adb kill-server` and run this step again.",
        ),
      ],
      commands: ["adb -d sideload /path/to/addon.zip"],
      needs: ["addon"],
      mode: "sideload",
      run: async (ctx) => {
        if (!ctx.has("addon")) {
          ctx.log("no add-on supplied, skipping");
          return;
        }
        const adb = await ctx.adb();
        const file = ctx.file("addon");
        ctx.log(`sideloading ${file.name}`);
        await sideload(adb, file, {
          onProgress: (f) => ctx.progress(f, "addon"),
          onLog: (l) => ctx.log(l),
        });
        ctx.progress(null);
      },
    });
  }

  installSteps.push({
    id: "first-boot",
    title: "Reboot into the new system",
    body: [
      text(
        device.uses_twrp && !device.is_ab_device
          ? "Reboot, System."
          : 'Back arrow, then "Reboot system now".',
      ),
      note(
        "First boot takes up to about 15 minutes. Longer than that usually means a " +
          "missed step rather than a slow phone.",
      ),
      ...(device.uses_twrp || device.custom_recovery_link
        ? [
            warn(
              "Do not let any 'keep this recovery installed?' prompt talk you into " +
                "letting the system replace the recovery.",
            ),
          ]
        : []),
    ],
    commands: ["adb -d reboot"],
    confirm: "It booted",
  });

  phases.push({
    id: "install",
    title: `Install ${options.os}`,
    steps: installSteps,
  });

  return {
    os: options.os,
    osVersion: options.osVersion,
    device,
    reference: options.reference,
    artifacts: options.artifacts,
    phases,
  };
}

/** The wiki has four different ways of getting from fastboot into recovery. */
function rebootToRecoveryStep(device: DeviceRecord, os: string): Step {
  const partition = recoveryPartition(device);
  const logoNote = note(
    `If the recovery that appears does not show the ${os} logo, you have booted the ` +
      `old one. The flash did not take — go back and repeat it rather than carrying on.`,
  );

  switch (device.recovery_reboot) {
    case "fastboot_menu":
      return {
        id: "to-recovery",
        title: "Reboot into the new recovery",
        body: [
          text(
            "Use the volume keys to move the bootloader menu to Recovery, then press " +
              "power to select it.",
          ),
          logoNote,
        ],
        confirm: "The new recovery is on screen",
      };
    case "fastboot_reboot":
      return {
        id: "to-recovery",
        title: "Reboot into the new recovery",
        body: [logoNote],
        commands: ["fastboot reboot recovery"],
        mode: "fastboot",
        run: async (ctx) => {
          const fb = await ctx.fastboot();
          await fb.reboot("recovery");
          ctx.log("rebooting into recovery");
        },
        confirm: "The new recovery is on screen",
      };
    case "fastboot_boot":
      return {
        id: "to-recovery",
        title: "Boot the recovery image",
        body: [logoNote],
        commands: [`fastboot boot ${partition}.img`],
        needs: ["recovery"],
        mode: "fastboot",
        run: async (ctx) => {
          const fb = await ctx.fastboot();
          await fb.bootOnce(ctx.file("recovery"), (f) => ctx.progress(f, "recovery"));
          ctx.progress(null);
        },
        confirm: "The new recovery is on screen",
      };
    case "fastboot_misc":
      return {
        id: "to-recovery",
        title: "Set the misc partition to boot recovery",
        body: [
          text(
            "This device needs a marker written to its misc partition to come up in " +
              "recovery. Download boot-recovery-misc.img from LineageOS and supply it below.",
          ),
          { link: "boot-recovery-misc.img", href: "https://blob.lineageos.org/downloads/boot-recovery-misc.img" },
          logoNote,
        ],
        commands: ["fastboot flash misc boot-recovery-misc.img", "fastboot reboot"],
        needs: ["misc"],
        mode: "fastboot",
        run: async (ctx) => {
          const fb = await ctx.fastboot();
          await fb.flash("misc", ctx.file("misc"), (f) => ctx.progress(f, "misc"));
          ctx.progress(null);
          await fb.reboot("");
        },
        confirm: "The new recovery is on screen",
      };
    default:
      return {
        id: "to-recovery",
        title: "Reboot into the new recovery",
        body: [
          warn(
            "Do not let it boot the existing system: on this device that would " +
              "overwrite the recovery you have just flashed.",
          ),
          text(
            device.recovery_boot ??
              "Power the device off and use its recovery key combination.",
          ),
          note(
            "If you cannot power it down, hold the key combination until it reboots, " +
              "then follow it through.",
          ),
          logoNote,
        ],
        confirm: "The new recovery is on screen",
      };
  }
}

export interface FactoryPlanOptions {
  os: string;
  osVersion?: string;
  reference?: { label: string; href: string };
  artifacts: Artifact[];
  /** Projects that want their own AVB key and a re-locked bootloader after. */
  relock?: boolean;
  notes?: Body[];
}

/**
 * Build the factory-image procedure: one signed zip, flashed by the bootloader
 * the way `fastboot update` would. This is how the Pixel-targeting projects --
 * GrapheneOS, CalyxOS, and Google's own factory images — ship.
 */
export function buildFactoryPlan(
  device: DeviceRecord,
  options: FactoryPlanOptions,
): Plan {
  return {
    os: options.os,
    osVersion: options.osVersion,
    device,
    reference: options.reference,
    artifacts: options.artifacts,
    phases: [
      {
        id: "prepare",
        title: "Before you start",
        steps: [
          {
            id: "read-first",
            title: "Read the whole procedure before starting anything",
            body: [
              text(`This erases everything on the ${device.name}, including internal storage.`),
              ...(options.notes ?? []),
              warn("If a step fails, stop rather than continuing."),
            ],
            confirm: "Read and backed up",
          },
          {
            id: "usb-debugging",
            title: "Enable developer options, USB debugging and OEM unlocking",
            body: [
              text(
                "Settings, About phone, tap Build number seven times; then Developer " +
                  "options, and turn on both USB debugging and OEM unlocking.",
              ),
            ],
            confirm: "Both are on",
          },
          {
            id: "to-bootloader",
            title: "Reboot into the bootloader",
            body: [
              text(
                device.download_boot
                  ? `By hand: ${device.download_boot}`
                  : "Power off, then use the bootloader key combination.",
              ),
            ],
            commands: ["adb -d reboot bootloader"],
            mode: "adb",
            run: async (ctx) => {
              const adb = await ctx.adb();
              await adb.reboot("bootloader");
              await adb.close();
            },
            confirm: "The phone is in the bootloader",
          },
        ],
      },
      {
        id: "unlock",
        title: "Unlock the bootloader",
        steps: [
          {
            id: "fastboot-connect",
            title: "Connect to the bootloader",
            commands: ["fastboot devices", "fastboot getvar product"],
            mode: "fastboot",
            run: async (ctx) => {
              const fb = await ctx.fastboot();
              const vars = await fb.probe();
              ctx.log(`product: ${vars.product ?? "unknown"}`);
              ctx.log(`bootloader: ${vars["version-bootloader"] ?? "unknown"}`);
              const unlocked = await fb.unlocked();
              ctx.log(
                unlocked === true ? "bootloader is unlocked"
                  : unlocked === false ? "bootloader is locked"
                  : "lock state not reported",
                unlocked === true ? "ok" : "warn",
              );
            },
          },
          {
            id: "unlock",
            title: "Unlock the bootloader",
            danger: "wipe",
            body: [
              warn("This erases the entire device."),
              text("Answer the confirmation the phone puts on its own screen."),
            ],
            commands: [device.custom_unlock_cmd ?? "fastboot flashing unlock"],
            mode: "fastboot",
            run: async (ctx) => {
              const fb = await ctx.fastboot();
              if ((await fb.unlocked()) === true) {
                ctx.log("already unlocked", "ok");
                return;
              }
              const cmd = device.custom_unlock_cmd ?? "fastboot flashing unlock";
              for (const op of parseUnlockCommand(cmd)) {
                if (op.kind === "reboot") {
                  await fb.reboot(op.target);
                  continue;
                }
                try {
                  ctx.log(`sending: ${op.text}`);
                  const reply = await fb.command(op.text);
                  if (reply) ctx.log(reply);
                } catch (err) {
                  ctx.log(`bootloader replied: ${(err as Error).message}`, "warn");
                }
              }
            },
            confirm: "The phone confirms it is unlocked",
          },
        ],
      },
      {
        id: "install",
        title: `Install ${options.os}`,
        steps: [
          {
            id: "flash-factory",
            title: "Flash the factory image",
            danger: "wipe",
            body: [
              text(
                "The whole zip goes on in one operation: bootloader, radio, and every " +
                  "system partition, exactly as `fastboot update` would do it.",
              ),
              warn(
                "The phone reboots between stages. Leave it plugged in and do not " +
                  "touch it. If the browser asks to reconnect to the device part-way " +
                  "through, that is expected — allow it.",
              ),
            ],
            commands: ["fastboot update --skip-reboot image.zip", "# or: ./flash-all.sh"],
            needs: ["factory"],
            mode: "fastboot",
            run: async (ctx) => {
              const fb = await ctx.fastboot();
              ctx.log("flashing factory image; this takes several minutes");
              await fb.flashFactoryZip(
                ctx.file("factory"),
                true,
                () => ctx.log("reconnect the device when prompted", "warn"),
                (action, item, fraction) => ctx.progress(fraction, `${action} ${item}`),
              );
              ctx.progress(null);
              ctx.log("factory image flashed", "ok");
            },
          },
          ...(options.relock
            ? [
                {
                  id: "relock",
                  title: "Re-lock the bootloader",
                  danger: "wipe" as const,
                  body: [
                    text(
                      "This project ships its own verified-boot key, so the bootloader " +
                        "can be locked again afterwards and still boot it.",
                    ),
                    warn(
                      "Only do this after the new OS has booted successfully at least " +
                        "once. Locking on top of a broken install leaves a phone that " +
                        "will neither boot nor be flashed.",
                    ),
                  ],
                  commands: ["fastboot flashing lock"],
                  mode: "fastboot" as const,
                  confirm: "Locked",
                },
              ]
            : []),
          {
            id: "first-boot",
            title: "Reboot into the new system",
            commands: ["fastboot reboot"],
            mode: "fastboot",
            run: async (ctx) => {
              const fb = await ctx.fastboot();
              await fb.reboot("");
            },
            confirm: "It booted",
          },
        ],
      },
    ],
  };
}
