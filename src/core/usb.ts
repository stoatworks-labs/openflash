// Getting the USB interface back off whoever is holding it.
//
// WebUSB lets exactly one holder claim an interface. Both transports in this
// app claim the same one on the same handset — fastboot in the bootloader, ADB
// in recovery — and the phone reboots between them several times during an
// install. If the previous holder is not released first, the next claim fails
// with "The device is already in used by another program", which is ya-webadb's
// DeviceBusyError and reads like something else has the phone.
//
// Usually the something else is us. Sometimes it genuinely is the user's own
// adb server, which grabs any Android device it sees the moment it starts.

/**
 * Close every device this origin has been granted, releasing any interface
 * still claimed on it. Harmless when nothing is open — a closed device stays
 * closed and permission is not revoked, so the next connect does not re-prompt.
 */
export async function releaseAllDevices(): Promise<void> {
  if (!navigator.usb) return;
  for (const device of await navigator.usb.getDevices()) {
    if (!device.opened) continue;
    try {
      await device.close();
    } catch {
      // The phone unplugging or rebooting mid-close is the normal case here.
    }
  }
}

/** ya-webadb wraps a failed claim in its own error type; match on the text. */
export function isDeviceBusy(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "DeviceBusyError" ||
    err.message.includes("already in used by another program") ||
    // The raw WebUSB failure, in case it reaches us unwrapped.
    (err.name === "NetworkError" && err.message.includes("claim"))
  );
}

export const DEVICE_BUSY_ADVICE =
  "Something else has claimed the phone's USB interface. If you have Android " +
  "platform-tools installed, that is almost always the adb server — run " +
  "`adb kill-server` and try this step again. Otherwise close any other browser " +
  "tab or app talking to the device. Unplugging and replugging clears it too.";
