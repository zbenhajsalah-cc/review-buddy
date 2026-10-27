# Review Buddy desktop (Electron)

The desktop app shows a review in the same viewer as the plugin
(`@review-buddy/viewer`), and gets its data from Electron main over IPC
instead of HTTP. Plan and stories: `docs/DESIGN-desktop-app-shared-code.md`,
`docs/backlog-desktop-app.md`.

**Status (US-08, US-09):** a skeleton. Main loads one fixed review
(`src/main/fixture/review.json`) through core (`validateAgentReview` →
`resolveReview`) and shows it. A command-line check proves the Agent SDK runs
from main with your Claude login (see "Claude (Agent SDK)"). GitHub, the
review agent and the PR screens come in later stories.

## Run it

```bash
pnpm install
pnpm --filter desktop dev      # electron-vite: main + preload + renderer with HMR
pnpm --filter desktop build    # production build into out/
pnpm --filter desktop start    # run the built app (out/)
pnpm --filter desktop smoke    # build, then drive the real app with Playwright
pnpm --filter desktop test     # unit tests (bun)
pnpm --filter desktop typecheck
pnpm --filter desktop agent-check  # one Agent SDK query from main (dev mode)
pnpm --filter desktop package  # unpacked app for this OS in release/ (electron-builder --dir)
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
src/main/agent/ # Agent SDK: the Claude Code binary path, the --agent-check run
src/preload/    # exposes window.reviewBuddy (the ReviewBridge); built as CommonJS
src/renderer/   # <ReviewViewer api={ipcReviewApi(window.reviewBuddy, key)} />
src/shared/     # the IPC contract (channel names + types), used by all three
scripts/        # smoke-desktop.ts
electron-builder.yml  # packaging (asarUnpack for the Claude Code binary)
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

## Claude (Agent SDK)

The app uses the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`, the only
production `dependency`). The SDK runs Claude Code as a child process, and
Claude Code uses the login you already have from `claude /login`. It reads
it from `~/.claude` on Linux and Windows, and from the Keychain on macOS. No API key is
needed.

**Check it** (prints one JSON line; exit code 0 = Claude answered):

```bash
pnpm --filter desktop agent-check                           # dev
release/linux-unpacked/review-buddy --agent-check           # packaged, Linux
"release/mac-arm64/Review Buddy.app/Contents/MacOS/Review Buddy" --agent-check  # packaged, macOS
```

The check asks one question with no tools, no settings files and no saved
session, in a temp folder. In the JSON:

- `answer: "pong"` and `ok: true`: the SDK started Claude Code and got an
  answer.
- `apiKeySource: "none"` means no API key was used. With your login, it is
  `"none"` and `account.subscriptionType` names your Claude plan.
  `"ANTHROPIC_API_KEY"` means Claude Code used an API key from the
  environment instead: unset it to use the login.
- No login: `ok: false` and `error: "Not logged in · Please run /login"`.
  Run `claude /login` once, outside the app.

**What was checked (US-09).** The check passed in dev mode and in a packaged
Linux build (`pnpm --filter desktop package`). It ran in a cloud container
whose credential comes from the host, not from `claude /login`. So the
`apiKeySource` / `subscriptionType` values for a real login are still to be
confirmed on your machine. Run the check once there. A failed login was
simulated with a fake API that answers 401; it gives the error above.

**Packaging needs**

- **The Claude Code binary must be unpacked.** The SDK's binary comes in an
  optional per-platform package (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>`).
  A file inside `app.asar` cannot be run (`spawn` fails with `ENOTDIR`).
  `asarUnpack` in `electron-builder.yml` puts it in `app.asar.unpacked`.
  electron-builder's default "smart unpack" also unpacks it, because it is an
  executable; the explicit rule makes sure it stays that way.
- **The SDK cannot find the unpacked copy by itself:** it resolves the binary
  inside `app.asar`. Main resolves the path the same way and maps it to
  `app.asar.unpacked` (`src/main/agent/executable.ts`), then passes it as
  `pathToClaudeCodeExecutable`. The same code runs in dev, where the path has
  no asar in it.
- **The SDK must stay external** (a `dependency`, not bundled), so its binary
  package is next to it in `node_modules`. electron-builder collects it from
  pnpm's layout. **No `node-linker=hoisted` is needed.**
- **One platform per build.** pnpm installs only this machine's binary
  package, so build each OS on that OS. electron-builder warns about the other
  platforms' packages; that is expected.
- **Size.** The binary is about 250 MB unpacked, about half of the 545 MB
  Linux app. If that is too much, US-18 can use the `claude` the user already
  has installed instead (`pathToClaudeCodeExecutable`). The cost is a Claude
  Code version that the app does not control.
- **Peers.** The SDK's peer dependencies (`@anthropic-ai/sdk`,
  `@modelcontextprotocol/sdk`, `zod`) are only needed for types. Its runtime
  imports only Node built-ins, and they are not packaged.

**Fallback if the login does not work in a packaged app:** ask for an
Anthropic API key once, keep it with Electron `safeStorage` (encrypted by the
OS keychain), and pass it to the SDK as `env.ANTHROPIC_API_KEY`. It is not
built, because the login works.

## pnpm and Electron

No special pnpm linker settings are needed. Main and preload bundle all their
imports (core, zod), so only `electron`, Node built-ins and the Agent SDK stay
external. The renderer is a normal Vite build. electron-builder packages the
one external package (and its platform binary) from pnpm's symlinked layout
(the default `node-linker=isolated`).

This is why every other package is a devDependency: electron-vite keeps only
`dependencies` external.

Still to do in US-18: icons, installers (dmg / AppImage / NSIS), signing.
