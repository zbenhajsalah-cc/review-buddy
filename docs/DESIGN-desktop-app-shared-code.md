# Design: shared code for a Review Buddy desktop app (Electron + pnpm monorepo)

**Status:** analysis and plan only, no code moved yet.

**Decisions made:**

- The second product is an **Electron desktop app**, not a hosted web app.
- It is for **personal use**, so the Agent SDK may use the Claude login that is
  already on the machine.
- The repo becomes a **pnpm monorepo**.

## Goal

A desktop app that makes the same narrative review (Prologue + risk-rated
Chapters) without starting from Claude Code:

1. The app gets a GitHub token.
2. It lists the user's repos, then the open PRs of a repo.
3. The user picks a PR. A Claude Agent SDK run reads the PR and produces the
   review (same agent contract as `submit_review`).
4. The same React viewer shows the result.

The Claude Code plugin and the standalone MCP mode (Cursor / Copilot / Codex)
must keep working exactly as today.

## Summary

| Bucket | Modules | Goes to |
|---|---|---|
| **Shared as-is** (pure, no I/O) | `types/review.ts`, `schemas/review.schema.json`, `server/diff.ts`, `server/resolve.ts`, `server/noise.ts`, `server/validate.ts`, pure helpers of `server/session.ts` | `packages/core` |
| **Shared after a small change** | `server/git.ts` (local git/gh capture), most of `ui/src/**`, the prompt body of `skills/review/SKILL.md` | `packages/core`, `packages/viewer` |
| **Plugin only** | `mcp/*`, `cli/index.ts`, `server/http.ts`, `server/browser.ts`, rest of `server/session.ts`, `hooks/`, `bin/`, `.claude-plugin/plugin.json`, `skills/`, `integrations/` | `apps/plugin` |
| **Desktop only (new)** | Electron main/preload, GitHub client, repo/PR screens, agent runner, review cache | `apps/desktop` |

The heart of the product, **`parseDiff` + `resolveReview`**, is already pure: it
takes a diff string, the agent JSON, PR metadata and meta, and returns a
`ResolvedReview`. It does not care where the diff came from. That is why the
split is cheap.

## 1. Shared as-is: `packages/core`

These modules have no file system access, no `git`/`gh` process, no Bun-only
API, and no HTTP. They run the same in Bun (plugin) and Node (Electron main).

| File | What it gives both apps |
|---|---|
| `src/types/review.ts` | Agent contract (`AgentReview`, `HunkAnchor`, …) and UI contract (`ResolvedReview`, …) |
| `schemas/review.schema.json` | Input schema of `submit_review`. The desktop agent's tool uses the same schema. |
| `src/server/diff.ts` | `parseDiff`, `languageOf` |
| `src/server/resolve.ts` | `resolveReview`: maps anchors onto real hunks, buckets unsorted/noise, recomputes stats, returns warnings |
| `src/server/noise.ts` | `isNoiseFile` |
| `src/server/validate.ts` | `validateAgentReview` |
| From `src/server/session.ts` | `requestChangesMessage`, `resolutionNotesMessage`, and `buildMeta({ generatedBy })` (take the model name as an argument instead of reading env) |
| From `src/server/http.ts` | `allowedPaths(review)`: "only files in this review may be read" |

Their tests move with them. **Rule for `core`: no `Bun.*`, no
`import.meta.dir`.** Electron main runs on Node.

`AgentReview.source` and `AgentReview.cwd` only matter for local capture. The
desktop app knows the PR before the agent runs, so it ignores them. No contract
change.

## 2. Shared after a small change

### 2.1 Where the bytes come from: `git.ts`

Electron main is Node with full local access, so **today's `git.ts` works there
unchanged** (it only uses `node:child_process` and `node:fs`). That gives the
desktop app two options. Both fit one interface:

```ts
interface ReviewDataSource {
  diff(): Promise<string>;
  pr(): Promise<PrMetadata>;
  /** "" = unavailable (same rule as fileContent today). */
  fileContent(path: string, side: "base" | "head"): Promise<string>;
}
```

| Option | How | Good | Bad |
|---|---|---|---|
| **A. GitHub REST** (`GitHubApiSource`) | `pulls/{n}` with `Accept: application/vnd.github.diff`; `pulls/{n}` JSON; `compare` for merge base; `contents/{path}?ref=` | No clone, fast for any repo | New code; GitHub refuses the `.diff` format for very large PRs |
| **B. Local clone** (`LocalGitSource`) | Keep a bare/partial clone per repo in the app's data folder; reuse `git.ts` | Reuses tested code; no size limit | Disk use; first clone of a big repo is slow |

Recommendation: **start with A** for listing and small/medium PRs. Add B
later as the fallback for very large PRs. A large PR must fail clearly, never
render a partial diff as complete ("never fabricate changes").

A is done (US-11): `apps/desktop/src/main/github/api-source.ts`. Beyond the
406 `too_large` answer, it also refuses any diff whose file and line counts
differ from the PR's. See `apps/desktop/README.md` "Reading a PR".

`git.ts` itself moves to `packages/core` (as a `node`-only subpath export, for
example `@review-buddy/core/node/git`) so both apps import the same file. Its guards
(`assertSafeRef`, `assertPrRef`, symlink check) move with it.

### 2.2 The viewer: `packages/viewer`

About 90% of `src/ui/src` is reusable as-is: `Overview`, `ChapterReview`,
`FileDiffCard`, `DisplaySettingsBar`, `RiskBadge`, `Markdown` (its "no images"
rule matters in Electron too), `ShortcutsDialog`, `CopyMarkdownButton`, all of
`lib/`, `settings.ts`, `workerPool.tsx`.

The coupling is in a few places only. Electron makes this change **required**,
not optional, because the desktop renderer talks to main over **IPC**, not
`fetch("/api/…")`:

| Place | Coupling | Change |
|---|---|---|
| `api.ts` | Fixed `/api/*` paths + token header | `ReviewApi` interface; today's code becomes `httpReviewApi` (plugin) |
| `session.ts` | Reads `?token=` from the URL | Only used by `httpReviewApi` |
| `lib/chapterFileSet.ts` | localStorage key = `rb.viewed.<token>` | Key by `reviewKey` from context (token in the plugin; `owner/repo#n@sha` in desktop) |
| `FileDiffCard.tsx` | Imports `fetchFileContent` | Read it from context |
| `ChapterReview.tsx` | Imports `fetchConfig` / `postDone` | Read them from context. In desktop, "Done" marks the review finished (later: post a GitHub review) |
| `App.tsx` | Loads one review on mount | Becomes `<ReviewViewer api />`; each app has its own shell |

```ts
interface ReviewApi {
  reviewKey: string;
  getReview(): Promise<ResolvedReview>;
  getFileContent(path: string, side: "base" | "head"): Promise<FileContent>;
  getConfig(): Promise<{ roundtrip: boolean }>;
  done(result: DoneResult): Promise<void>;
}
```

- Plugin: `apps/plugin/ui` = a tiny Vite entry that mounts
  `<ReviewViewer api={httpReviewApi} />` and builds the committed `dist/`.
- Desktop: the renderer mounts `<ReviewViewer api={ipcReviewApi} />`, where
  `ipcReviewApi` calls functions exposed by the preload script
  (`contextBridge`).

Tailwind note: the viewer's CSS today scans only its own folder
(`@import "tailwindcss" source(".")`, see `DESIGN-prebuilt-distribution.md`).
Each app's CSS must add `@source` for `packages/viewer/src`, or the classes are
missing.

### 2.3 The prompt

`skills/review/SKILL.md` = **Step 0** ("run `git diff` / `gh pr diff`, set
`source` and `cwd`"), which depends on the harness, + **Steps 1–3 and Critical
rules**, which are the product. `scripts/gen-prompts.ts` already builds one
prompt per harness from `integrations/prompt-template.md`. Add a desktop
variant, where Step 0 is "call `get_pr_diff`" and there is no `source`/`cwd`.
The template moves to `packages/core/prompts/`.

## 3. Plugin only: `apps/plugin`

`src/mcp/*`, `src/cli/index.ts`, `src/server/http.ts` (the loopback server),
`src/server/browser.ts`, the local part of `session.ts` (`openReviewSession`), `hooks/hooks.json`, `bin/review-buddy.js`,
`.claude-plugin/plugin.json`, `skills/`, `integrations/`, `examples/`.

## 4. Desktop only: `apps/desktop`

- **Electron main (Node):** GitHub client, agent runner, review cache.
- **Preload:** exposes a small IPC API with `contextBridge`. The renderer gets
  no Node access (`contextIsolation: true`, `nodeIntegration: false`, `sandbox:
  true`) and keeps a strict CSP, same as the plugin viewer. The review text
  comes from PRs and the agent, so treat it as untrusted.
- **GitHub token:** for personal use, the simplest path is `gh auth token` if
  `gh` is logged in. Otherwise use GitHub OAuth device flow, or let the user
  paste a token. Store it with Electron `safeStorage`. Done in US-10 (gh, or a
  pasted token; device flow later): `apps/desktop/README.md` "GitHub login".
- **Claude:** the Agent SDK runs Claude Code under the hood. For personal use it
  can use the login already on the machine. Checked in US-09: from Electron
  main, in dev and in a packaged Linux build. The Claude Code binary (an
  optional per-platform package of the SDK) must be unpacked from the asar,
  and main passes its unpacked path as `pathToClaudeCodeExecutable`. Details
  and the remaining check on a real login: `apps/desktop/README.md`.
- **Agent runner:** `query()` with an **in-process MCP tool** `submit_review`
  (same JSON schema) whose handler runs `validateAgentReview` → `resolveReview`
  and returns the resolution notes to the agent, so it can fix bad anchors in
  the same run. Give the agent read-only tools backed by the data source
  (`get_pr_diff`, `read_file`), not a shell. The agent and `resolveReview` read
  the **same** diff string, so anchors line up exactly. Done in US-12
  (`apps/desktop/src/main/agent/`). The SDK's `tool()` takes zod, so the
  shared JSON schema (minus `cwd` and `source`) goes through
  `z.fromJSONSchema`; a test checks the schema the agent sees is the shared
  one. A large diff comes in parts that join back to the exact string.
- **Jobs:** a review takes minutes. Run it in main, stream progress to the
  renderer, allow cancel. US-12: one run at a time in main; the renderer polls
  its status (steps so far) and can stop it.
- **Cache:** keep `ResolvedReview` per `owner/repo#n@headSha` in the app data
  folder, so reopening a PR does not re-run the agent. Re-run when the head SHA
  changes.

## 5. pnpm monorepo

### Target layout

```
review-buddy/
├── pnpm-workspace.yaml          # packages/*, apps/*
├── package.json                 # private root: shared scripts, biome, typescript
├── .claude-plugin/marketplace.json   # plugin "source": "./apps/plugin"
├── packages/
│   ├── core/                    # @review-buddy/core
│   └── viewer/                  # @review-buddy/viewer (React, no app shell)
├── apps/
│   ├── plugin/                  # Claude Code plugin + standalone MCP (self-contained)
│   │   ├── .claude-plugin/plugin.json
│   │   ├── hooks/ skills/ bin/ integrations/
│   │   ├── src/                 # mcp, cli, http, browser, session
│   │   ├── ui/                  # Vite entry for the viewer
│   │   └── dist/                # COMMITTED: server.js, hook.js, ui/
│   └── desktop/                 # Electron app
└── docs/
```

### The one hard problem: plugin install

Today `/plugin install` is a **git clone with no `node_modules`**, and Bun
**auto-installs** `@modelcontextprotocol/sdk` and `zod` on first launch (see
README). In a workspace, the plugin would import `@review-buddy/core`, which is
not on npm, so auto-install cannot find it. The installed plugin would break.

Also, a plugin whose marketplace `source` is a subfolder is copied alone into
Claude Code's plugin cache, so it cannot reach `packages/` with a relative path
either.

**Fix: bundle the plugin**, the same way the viewer is already shipped
prebuilt:

- `bun build --target=bun` turns `src/mcp/server.ts` and `src/cli/index.ts` into
  `apps/plugin/dist/server.js` and `apps/plugin/dist/hook.js`, with `core`,
  `zod` and the MCP SDK inlined.
- `plugin.json` and `hooks.json` point at `dist/*.js`. The schema JSON is
  inlined too (no runtime `readFileSync` of `../../schemas`).
- Commit `dist/`, extend `verify:dist-fresh` to cover it, and mark it
  `linguist-generated` in `.gitattributes`.
- Bonus: the first launch no longer needs network access, and GitHub installs
  run the tested versions. (Measured: Bun auto-install ignores `bun.lock` and
  takes the newest versions in range, so today GitHub installs float.)

Test before merging: copy `apps/plugin` alone into an empty temp folder with no
`node_modules`, then run the hook and MCP server from there.

### Bun and pnpm together

- **pnpm** owns installs and workspaces (`workspace:*` links, one
  `pnpm-lock.yaml`). `src/ui/bun.lock` is removed. The root `bun.lock` stays
  until the plugin is bundled, because local-clone installs run `bun install`,
  which does not read `pnpm-lock.yaml`.
- **Bun** stays the plugin's runtime and the test runner (`bun test` works on a
  pnpm `node_modules`). Users of the plugin still need Bun, as today.
- **Electron** packaging with pnpm's symlinked `node_modules` often needs
  `node-linker=hoisted` for that app (set in `apps/desktop/.npmrc` or via the
  packager's config). Checked in US-08: not needed for `dev`, `build` and
  `start`, because main and preload bundle all their imports and the built
  app needs no `node_modules`. US-09 added the Agent SDK as the one external
  package; electron-builder packages it from pnpm's layout, still without
  `hoisted`. See `apps/desktop/README.md`.
- CI: install pnpm from `packageManager`, keep `oven-sh/setup-bun` (version
  from `.bun-version`), `pnpm install --frozen-lockfile`.

(Bun also has native workspaces. pnpm is chosen; this is only noted because
Bun is already required.)

### Paths that change in the move

`.claude-plugin/marketplace.json` (`source`), `plugin.json` + `hooks.json`
(entry paths), `bin/review-buddy.js`, all `integrations/*` MCP configs and
`docs/HARNESSES.md` (`/PATH/TO/review-buddy/src/mcp/server.ts` →
`apps/plugin/dist/server.js`), `scripts/release.sh` (`VERSION_FILES`),
`scripts/gen-prompts.ts`, `.github/workflows/ci.yml`, `package.json` scripts,
`biome.jsonc`, `tsconfig*.json`, `.gitignore` + `.gitattributes` (dist
exceptions), `uiDir()` in `session.ts`, `CLAUDE.md`, `README.md`, the docs.

**User impact:** GitHub installs keep working once the marketplace points to
`./apps/plugin`. Local-clone installs and the Cursor / Copilot / Codex configs
need the new path, so this is a breaking change for those users. Note it in the
release notes.

## 6. Suggested order

Each step keeps `verify:ci` green and the plugin behaving the same. The
detailed user stories are in `backlog-desktop-app.md`.

1. **pnpm workspace + `packages/core`.** Add `pnpm-workspace.yaml`, move the
   pure modules and their tests to `packages/core`, switch installs to pnpm. The
   plugin still runs from `src/` and imports core through tsconfig `paths`
   (not a workspace link, which unbundled plugin installs cannot resolve).
2. **Bundle the plugin.** Add the `bun build` step and the committed `dist/`, and
   test the "no `node_modules`" install. This must land before or together
   with step 3.
3. **Move the plugin to `apps/plugin`.** Update every path listed above.
4. **`packages/viewer` + `ReviewApi`.** Split the viewer from its shell; the
   plugin uses `httpReviewApi`. Rebuild `dist/`.
5. **Desktop spike.** Electron + Agent SDK login + `gh auth token` + one
   hard-coded PR → `resolveReview` → `<ReviewViewer api={ipcReviewApi} />`.
6. **Desktop app.** Repo/PR screens, jobs with progress, cache, packaging.
