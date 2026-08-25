// Node's ESM resolver requires file extensions; the source is written for a
// bundler and omits them. This hook adds the `.ts` back so the checks in this
// directory can import the real modules rather than a copy of them.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && !/\.[mc]?[jt]s$/.test(specifier)) {
      const url = new URL(specifier, context.parentURL);
      for (const candidate of [`${url.href}.ts`, `${url.href}/index.ts`]) {
        if (existsSync(fileURLToPath(candidate))) return next(candidate, context);
      }
    }
    return next(specifier, context);
  },
});
