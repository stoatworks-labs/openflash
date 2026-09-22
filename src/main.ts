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
