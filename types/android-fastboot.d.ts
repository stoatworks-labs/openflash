// android-fastboot ships JavaScript with no bundled type definitions, so we
// declare the surface we actually use. Kept deliberately narrow: if upstream
// changes a signature we rely on, this file is the single place it shows up.
declare module "android-fastboot" {
  export type FlashProgressCallback = (progress: number) => void;
  export type ReconnectCallback = () => void;
  export type FactoryProgressCallback = (
    action: string,
    item: string,
    progress: number,
  ) => void;

  export interface CommandResponse {
    text: string;
    dataSize?: string;
  }

  export class UsbError extends Error {}
  export class FastbootError extends Error {
    status: string;
    bootloaderMessage: string;
  }
  export class TimeoutError extends Error {}

  export const USER_ACTION_MAP: Record<string, string>;

  export function setDebugLevel(level: number): void;
  export function configureZip(options: Record<string, unknown>): void;

  export class FastbootDevice {
    device: USBDevice | null;
    readonly isConnected: boolean;

    connect(): Promise<void>;
    waitForConnect(onReconnect?: ReconnectCallback): Promise<unknown>;
    waitForDisconnect(): Promise<unknown>;

    runCommand(command: string): Promise<CommandResponse>;
    getVariable(name: string): Promise<string | null>;

    reboot(
      target?: string,
      wait?: boolean,
      onReconnect?: ReconnectCallback,
    ): Promise<void>;

    flashBlob(
      partition: string,
      blob: Blob,
      onProgress?: FlashProgressCallback,
    ): Promise<void>;

    bootBlob(blob: Blob, onProgress?: FlashProgressCallback): Promise<void>;

    flashFactoryZip(
      blob: Blob,
      wipe: boolean,
      onReconnect: ReconnectCallback,
      onProgress?: FactoryProgressCallback,
    ): Promise<void>;
  }
}
