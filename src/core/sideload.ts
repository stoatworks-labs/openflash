// `adb sideload`, implemented against the raw ADB socket.
//
// ya-webadb doesn't ship a sideload command, but the protocol is small. The
// host opens `sideload-host:<size>:<blocksize>`; the recovery then drives the
// transfer by asking for blocks, eight ASCII digits at a time, and the host
// answers each request with that block of the file. Recovery reads mostly, but
// not strictly, in order — it will jump back to re-read the payload metadata
// on an A/B update — so this must genuinely seek rather than stream.
//
// Reference: AOSP system/core/adb, `adb_sideload_host`.

import { BufferedReadableStream } from "@yume-chan/stream-extra";
import type { AdbSession } from "./adb";

/** What AOSP's fastboot/adb uses; recovery expects to negotiate it. */
const BLOCK_SIZE = 64 * 1024;
const DONE = "DONEDONE";
const FAIL = "FAILFAIL";

export interface SideloadOptions {
  onProgress?: (fraction: number) => void;
  onLog?: (line: string) => void;
  /**
   * Recovery has asked for nothing for a while. Nearly always it is waiting for
   * an answer on the handset rather than broken, so this reports how far the
   * transfer got instead of failing — the caller decides what to say.
   */
  onStall?: (served: number, total: number, seconds: number) => void;
  signal?: AbortSignal;
}

/** How long recovery may say nothing before we mention it, then keep mentioning it. */
const FIRST_STALL_MS = 20_000;
const REPEAT_STALL_MS = 60_000;
/** Opening the service should be immediate; if it is not, it is not on offer. */
const OPEN_TIMEOUT_MS = 15_000;

function delay(ms: number): { promise: Promise<null>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

/**
 * Push `file` to a device sitting in "Apply update from ADB".
 *
 * Resolves when recovery reports DONEDONE. Note that a *successful* sideload
 * often ends with the socket dropping rather than a clean close — recovery
 * reboots itself — so a read error after DONE is not an error.
 */
export async function sideload(
  session: AdbSession,
  file: File,
  options: SideloadOptions = {},
): Promise<void> {
  const { onProgress, onLog, onStall, signal } = options;
  const size = file.size;
  const totalBlocks = Math.ceil(size / BLOCK_SIZE);

  onLog?.(`sideload: ${file.name}, ${size} bytes, ${totalBlocks} blocks of ${BLOCK_SIZE}`);

  // A device that is not sitting in "Apply update from ADB" has no sideload
  // service to open, and the OPEN simply never gets answered. Without this the
  // symptom is a page that hangs with no explanation at all.
  const opening = session.adb.createSocket(`sideload-host:${size}:${BLOCK_SIZE}`);
  const openTimer = delay(OPEN_TIMEOUT_MS);
  const socket = await Promise.race([opening, openTimer.promise]);
  openTimer.cancel();

  if (!socket) {
    throw new Error(
      "Recovery did not accept a sideload connection. Check the phone: it has to " +
        "be showing \"Apply update from ADB\" — select Apply update, then Apply " +
        "from ADB on the handset, then run this step again.",
    );
  }

  const reader = new BufferedReadableStream(socket.readable);
  const writer = socket.writable.getWriter();
  const decoder = new TextDecoder();
  let highWater = 0;

  try {
    for (;;) {
      if (signal?.aborted) throw new Error("Cancelled.");

      // Keep one read in flight across however many stall reports it takes:
      // abandoning and re-issuing it would lose the request when it arrives.
      const pending = Promise.resolve(reader.readExactly(8)).then((value) => ({ value }));
      let waited = 0;
      let next = FIRST_STALL_MS;
      let received: { value: Uint8Array } | null = null;

      while (!received) {
        const timer = delay(next);
        received = await Promise.race([pending, timer.promise]);
        timer.cancel();
        if (!received) {
          waited += next;
          onStall?.(highWater, totalBlocks, Math.round(waited / 1000));
          next = REPEAT_STALL_MS;
        }
      }

      const request = decoder.decode(received.value);

      if (request === DONE) {
        onProgress?.(1);
        onLog?.("sideload: recovery reported DONEDONE");
        return;
      }
      if (request === FAIL) {
        throw new Error(
          "Recovery rejected the package. The usual cause is a zip built for a " +
            "different device, or a corrupted download.",
        );
      }

      const block = Number.parseInt(request, 10);
      if (!Number.isFinite(block) || block < 0 || block >= totalBlocks) {
        throw new Error(`Recovery asked for block "${request}", which is not a block of this file.`);
      }

      const offset = block * BLOCK_SIZE;
      const end = Math.min(offset + BLOCK_SIZE, size);
      const chunk = new Uint8Array(await file.slice(offset, end).arrayBuffer());
      await writer.write(chunk);

      // Recovery can revisit earlier blocks, so progress is the furthest point
      // reached, not the latest request — otherwise the bar jumps backwards.
      if (block + 1 > highWater) {
        highWater = block + 1;
        onProgress?.(highWater / totalBlocks);
      }
    }
  } finally {
    try {
      await writer.close();
    } catch {
      // Recovery hanging up first is the normal ending.
    }
    try {
      await socket.close();
    } catch {
      // As above.
    }
  }
}
