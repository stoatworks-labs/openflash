import { defineConfig } from "vite";

// Static site: no server component by design. Everything the tool does happens
// in the page, so it can be served from any static host (or a local file server)
// and audited by whoever runs it.
export default defineConfig({
  base: "./",
  resolve: {
    alias: {
      // android-fastboot's package.json only names its CommonJS build, which
      // drags a Node `url` import into the bundle. The ESM build next to it is
      // the same library without that.
      "android-fastboot": "android-fastboot/dist/fastboot.mjs",
    },
  },
  build: { target: "es2022", sourcemap: true },
});
