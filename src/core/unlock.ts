// Parsing the wiki's per-device unlock commands.
//
// Kept apart from the USB code deliberately: this is pure string handling, it
// is the piece most likely to be wrong for some obscure device, and having it
// standalone means the checks in scripts/ can exercise all 733 devices' unlock
// commands without pulling in a USB stack.

export type UnlockOp =
  | { kind: "raw"; text: string }
  | { kind: "reboot"; target: string };

/**
 * Turn a wiki `custom_unlock_cmd` into operations to send.
 *
 * Two things make this less trivial than it looks. Free-form commands go on
 * the wire with spaces, not colons: AOSP fastboot builds `oem unlock` and
 * `flashing unlock` by joining the arguments with spaces, and only the
 * protocol's own commands (`getvar:`, `flash:`, `download:`) use colons. And a
 * couple of devices -- the Nubia Z17 pair -- carry a three-line sequence with a
 * reboot in the middle, so this returns a list rather than a string.
 */
export function parseUnlockCommand(command: string): UnlockOp[] {
  const ops: UnlockOp[] = [];

  for (const line of command.split("\n")) {
    const trimmed = line.trim().replace(/^fastboot\s+/, "");
    if (trimmed.length === 0) continue;

    const reboot = /^reboot(?:\s+(\S+))?$/.exec(trimmed);
    if (reboot) {
      ops.push({ kind: "reboot", target: reboot[1] ?? "" });
      continue;
    }

    // The wiki writes these as you would type them into a shell, so a quoted
    // argument arrives with its quotes. The bootloader wants the contents.
    ops.push({ kind: "raw", text: trimmed.replace(/'([^']*)'/g, "$1") });
  }

  return ops;
}
