# CLAUDE.md — openflash

Short command reference. `AGENTS.md` has the model and the traps;
`docs/NOTES.md` has the repo-specific history.

## Commands

```bash
npm install
npm run dev          # dev server on :5183
npm run check        # typecheck + sha256 + unlock + plan checks — run before committing
npm run build        # static site into dist/
npm run devices      # regenerate public/data/devices.json from the LineageOS wiki
node scripts/screenshot.mjs   # README screenshots (needs `npm run dev` running)
```

## Rules

- `public/data/devices.json` is **generated and committed**. Never hand-edit it;
  change `scripts/build-device-db.mjs` and regenerate.
- Never add a step that flashes a file the plan does not list in `artifacts` —
  `check:plans` enforces this.
- Never send a free-form fastboot command colon-joined. See `docs/NOTES.md`.
- Anything that must run under the Node checks cannot import `fastboot.ts` or
  `adb.ts` (TypeScript parameter properties break strip-only mode).
