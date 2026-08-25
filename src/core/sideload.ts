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
  signal?: AbortSignal;
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
  const { onProgress, onLog, signal } = options;
  const size = file.size;
  const totalBlocks = Math.ceil(size / BLOCK_SIZE);

  onLog?.(`sideload: ${file.name}, ${size} bytes, ${totalBlocks} blocks of ${BLOCK_SIZE}`);

  const socket = await session.adb.createSocket(
    `sideload-host:${size}:${BLOCK_SIZE}`,
  );

  const reader = new BufferedReadableStream(socket.readable);
  const writer = socket.writable.getWriter();
  const decoder = new TextDecoder();
  let highWater = 0;

  try {
    for (;;) {
      if (signal?.aborted) throw new Error("Cancelled.");

      const request = decoder.decode(await reader.readExactly(8));

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
