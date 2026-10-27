# Review Buddy desktop (Electron)

The desktop app shows a review in the same viewer as the plugin
(`@review-buddy/viewer`), and gets its data from Electron main over IPC
instead of HTTP. Plan and stories: `docs/DESIGN-desktop-app-shared-code.md`,
`docs/backlog-desktop-app.md`.

**Status (US-08):** a skeleton. Main loads one fixed review
(`src/main/fixture/review.json`) through core (`validateAgentReview` →
`resolveReview`) and shows it. GitHub, the agent and the PR screens come in
later stories.

## Run it

```bash
pnpm install
pnpm --filter desktop dev      # electron-vite: main + preload + renderer with HMR
pnpm --filter desktop build    # production build into out/
pnpm --filter desktop start    # run the built app (out/)
pnpm --filter desktop smoke    # build, then drive the real app with Playwright
pnpm --filter desktop test     # unit tests (bun)
pnpm --filter desktop typecheck
```

The root has the same commands as `pnpm dev:desktop`, `build:desktop`,
`smoke:desktop`, `test:desktop` and `typecheck:desktop`. `verify:ci` runs the
tests, the typecheck and the build. It does not run the smoke test, because
that needs the Electron binary and a display.

- **Electron binary.** Since Electron 44, `pnpm install` does not download the
  binary (there is no postinstall script, so pnpm's `allowBuilds` is not
  needed). It downloads on first launch, or ahead of time with
  `pnpm --filter desktop exec install-electron`.
- **Linux without a display** (CI, containers): run under `xvfb-run -a`. As
  root, Chromium needs `--no-sandbox`: `pnpm --filter desktop dev --noSandbox`.
  The smoke test adds that flag by itself when it runs as root.
- **Smoke test runtime:** Node ≥ 22.18 (it runs a `.ts` file directly). It
  does not run on Bun: Playwright's Electron launch hangs there.

## Layout

```
src/main/       # Electron main (Node): window, app:// protocol, IPC handlers, review store
src/preload/    # exposes window.reviewBuddy (the ReviewBridge); built as CommonJS
src/renderer/   # <ReviewViewer api={ipcReviewApi(window.reviewBuddy, key)} />
src/shared/     # the IPC contract (channel names + types), used by all three
scripts/        # smoke-desktop.ts
```

## Security

The renderer shows text from PRs and from the agent, so it is treated as
untrusted:

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The
  preload exposes four review calls, never `ipcRenderer` itself.
- Main answers IPC only from our renderer page (it checks the sender frame's
  URL) and checks every argument. File reads are limited to the review's own
  files, as in the plugin (`allowedPaths`).
- The built renderer is served from `app://renderer/`, not `file://`. Every
  response carries the plugin viewer's CSP (`VIEWER_CSP` in
  `packages/core/src/viewer-csp.ts`). Dev mode adds only what Vite needs:
  inline scripts for React Refresh and the HMR websocket.
- Links (`target="_blank"`, `window.open`, navigation) open in the system
  browser, and only `http:`/`https:` links are opened. The window never
  navigates away from the app, and `<webview>` is blocked.
- The only permission granted is clipboard write, for the copy buttons.

## pnpm and Electron

No special pnpm linker settings are needed for now. Main and preload bundle
all their imports (core, zod), so only `electron` and Node built-ins stay
external. The renderer is a normal Vite build. The built app in `out/`
needs no `node_modules`, so pnpm's symlinked layout (the default
`node-linker=isolated`) works for `dev`, `build` and `start`.

This is why every package is a devDependency: electron-vite keeps only
`dependencies` external.

Still to check: packaging (US-18), and the Agent SDK (US-09). The SDK starts
a child process from its own package files, so it probably has to stay
external and unpacked from the asar. That may need `node-linker=hoisted` for
this app, or the packager's own dependency collection.
