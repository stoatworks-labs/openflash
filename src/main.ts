// Vendored from stoatworks-backend/theme by scripts/sync-theme.sh: first, so style.css layers over it.
import "./stoatworks-theme.css";
import "./ui/style.css";
import { start } from "./ui/app";
import { registerServiceWorker } from "./register-sw";

const root = document.getElementById("app");
if (root) {
  void start(root).catch((err: unknown) => {
    root.textContent = `openflash failed to start: ${(err as Error).message}`;
  });
}

registerServiceWorker();
