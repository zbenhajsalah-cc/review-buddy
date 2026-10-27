# Review Buddy desktop (Electron)

The desktop app shows a review in the same viewer as the plugin
(`@review-buddy/viewer`), and gets its data from Electron main over IPC
instead of HTTP. Plan and stories: `docs/DESIGN-desktop-app-shared-code.md`,
`docs/backlog-desktop-app.md`.

**Status (US-08 to US-15):** the app opens on your GitHub repositories (see
"Repositories"). Pick one to see its open PRs (see "Pull requests") and
review one or several of them (or type any `owner/repo#123` or PR URL in the
top bar): main reads each PR from the GitHub API (see "Reading a PR"), Claude
reviews it with your Claude login (see "Reviewing a PR"), and the viewer
shows the result. You see each review's progress as it runs, can stop it,
and can try again after a failure. The "Sample review" tab shows a fixed review
(`src/main/fixture/review.json`) until you follow a review. The settings view
connects GitHub (see "GitHub login"). Reviews are kept in memory only, until
the app quits (the review cache is US-16).

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
pnpm --filter desktop review-e2e   # build, then one real agent review in the app (costs tokens)
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
src/main/agent/ # Agent SDK: the Claude Code binary path, --agent-check, the review tools, runner and job
src/main/github/ # GitHub login (gh CLI token, pasted token in safeStorage), repo and PR lists, GitHubApiSource
src/preload/    # exposes window.reviewBuddy = { review, github }; built as CommonJS
src/renderer/   # App shell (top bar, tabs) + repo and PR lists + <ReviewViewer api={ipcReviewApi(...)} /> + GitHub settings
src/shared/     # the IPC contract (channel names + types), used by all three
scripts/        # smoke-desktop.ts (no Claude), review-e2e.ts (the real agent)
electron-builder.yml  # packaging (asarUnpack for the Claude Code binary)
```

## Security

The renderer shows text from PRs and from the agent, so it is treated as
untrusted:

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The
  preload exposes seven review calls and four GitHub calls, never
  `ipcRenderer` itself.
- Main answers IPC only from our renderer page: the sender frame's URL must
  be `index.html` (or `/`) on `app://renderer` (the Vite server in dev). Any
  other file on that origin gets no IPC. Main also checks every argument. File reads are limited to the review's own
  files, as in the plugin (`allowedPaths`).
- The built renderer is served from `app://renderer/`, not `file://`. Every
  response carries the plugin viewer's CSP (`VIEWER_CSP` in
  `packages/core/src/viewer-csp.ts`). Dev mode adds only what Vite needs:
  inline scripts for React Refresh and the HMR websocket.
- Links (`target="_blank"`, `window.open`, navigation) open in the system
  browser, and only `http:`/`https:` links are opened. The window never
  navigates away from the app, and `<webview>` is blocked.
- The only permission granted is clipboard write, for the copy buttons.
- The GitHub token never reaches the renderer (see "GitHub login").

## GitHub login

Open it with the button at the top right ("Connect GitHub", or
"GitHub: @you" once connected).

**Where the token comes from**, in this order:

1. **A token you pasted** in the settings. Create a
   [fine-grained token](https://github.com/settings/personal-access-tokens/new)
   with read access to Contents, Pull requests and Metadata.
2. **The GitHub CLI**, if `gh` is installed and logged in (`gh auth token`).
   Nothing to set up. A packaged app does not get your shell's PATH, so the app
   also looks in `/opt/homebrew/bin`, `/usr/local/bin` and the other usual
   folders.

Every token is checked with `GET /user` before use; the settings show the
login. The OAuth device flow is for later.

**Where it is kept**

- The token lives in main only. The renderer gets a status (login, source,
  errors) and never the token: no IPC call returns it. A pasted token goes
  from the form to main once, and the form is cleared.
- A pasted token is saved in `<userData>/github-token`, encrypted with Electron
  `safeStorage` (Keychain on macOS, DPAPI on Windows, the Secret Service or
  KWallet on Linux). If Linux has no keyring, safeStorage would use a fixed
  key ("basic_text"); then nothing is written and the token is kept for this
  run only. The settings say which one applies.
- A gh token is not saved by the app: gh keeps it in the OS keychain, and the
  app asks gh again at the next start.

**Sign out** deletes a pasted token. For a gh login, it makes the app stop
using gh (`ghDisabled` in `<userData>/settings.json`) but does not log gh out.
"Use the GitHub CLI login" turns gh back on.

**At start:** if GitHub rejects a saved token (401), the app deletes it, says
so once in the settings, and tries gh. If GitHub cannot be reached, the
token is kept and the next status check tries again.

Main uses Electron's `net.fetch`, so system proxy settings apply.

**Later 401s:** if GitHub rejects the token on a later call (the repo list,
for now), the app signs out the same way: a pasted token is deleted, a gh
login is just no longer used until "Use the GitHub CLI login", and the reason
shows once.

**Tests:** unit tests use a fake GitHub and a fake safeStorage. The smoke
test replaces `net.fetch` in main with a fake GitHub, so sign-in, a rejected
token and sign-out run the same on every machine, with no network and no real
token. It uses its own `--user-data-dir`. On a machine with a keyring it also
checks that the saved file does not contain the token. In the Linux
container, a GNOME keyring was started for that check (`dbus-run-session` +
`gnome-keyring-daemon --unlock`); without one, it checks that nothing is
written.

## Repositories

The start screen (`src/renderer/src/RepoList.tsx`, data from
`src/main/github/repos.ts`):

- **The list** is `GET /user/repos?sort=pushed`, 100 per page, newest push
  first: every repo the login owns, collaborates on, or sees through an
  organization. Each row shows `owner/name`, the description, Private / Fork
  / Archived, and the last push. **Load more** reads the next page (GitHub's
  `Link` header says if there is one). A fine-grained token sees only the
  repos it was given.
- **Search** filters the loaded pages by name and description (every word
  must match). While more pages exist, it says how many repos it searched.
- **Recently used** repos come first (at most 8). A repo is "used" when you
  pick it, or when a review of one of its PRs starts. The names are kept in
  `<userData>/settings.json` (`recentRepos`); page 1 reads them again with the
  current login, so a repo that login cannot see is not shown.
- **Picking a repo** opens its PR list (see "Pull requests").
- **States:** loading, not connected (a button to the GitHub settings and the
  sample review), no repos, no match, and errors with **Try again**. A 401
  means the token expired or was revoked: the list says so and the app signs
  out (see "GitHub login"). A used-up rate limit says when to try again.

The list stays loaded while you look at a review or the settings; **Refresh**
reads it again. Failures come back as answers (`{ ok: false, reason, error }`),
not IPC errors, so the screen can tell "token expired" from the rest.

**Tests:** `repos.test.ts` uses a fake GitHub built from a recorded repo
(`GET /repos/zbenhajsalah-cc/review-buddy`; `/user/repos` itself could not be
recorded from the build container, and its items have the same shape). The
smoke test runs the screen against a fake GitHub with two pages: flags, last
push, search, Load more, a picked repo first after Refresh, and an expired
token.

## Pull requests

A repo's open PRs (`src/renderer/src/PullList.tsx`, data from
`src/main/github/pulls.ts`), most recently updated first:

- **The list** is `GET /repos/{o}/{r}/pulls?state=open&sort=updated`, 30 per
  page with **Load more**. Each row shows the number, title (a link to
  GitHub), Draft, author, last update, and the size: `+additions −deletions ·
  N files`. The list endpoint has no sizes, so main reads each PR
  (`GET /pulls/{n}`), 8 at a time, and keeps the size per PR head, so a
  refresh reads only PRs with new commits. A size that cannot be read, or
  takes over 10 s, is left out.
- **What the app has for each PR:** **Reviewed** (a review of the PR's
  current head, with **Open review**), **Outdated review** (the PR has new
  commits since; **Open review** or **Review again**), **Queued** (with
  **Remove**), **Reviewing…** (with **Show progress**), or "Last review
  failed: …" with the reason. While a review runs, the row shows its phase
  and time. Reviews are in memory until the app quits (US-16 saves them).
- **Starting reviews:** **Review** on a row starts one and shows its
  progress. Tick several rows and press **Review selected** to queue them;
  you stay on the list and the rows show their progress. Two reviews run at
  a time; the others wait (see "Reviewing a PR"). After a failure, the
  row's button is **Try again**.
- **States:** loading, no open PRs, errors with **Try again**; "not found"
  when the repo is gone or the token cannot see it; a 401 signs the app out,
  as in the repo list.

**Tests:** `pulls.test.ts` uses list items made from the PR fixture
(`pr-28.json` without its size fields: GitHub's list items lack them; this
repo has no open PRs to record). The smoke test runs the screen against a
fake GitHub: rows, Draft, a missing size, Load more, and **Review selected**
on two PRs that then fail (no Claude needed), in order. The real-agent check
(`review-e2e`) starts its review from the PR list and then checks that the PR
shows **Reviewed** and that **Open review** opens it.

## Reading a PR (`GitHubApiSource`)

`src/main/github/api-source.ts` is the desktop's `ReviewDataSource`: the same
interface as the plugin's `LocalGitSource`, but over the GitHub REST API, so a
PR can be reviewed without a clone. `openGitHubPr({ owner, repo, number })`
reads, with the app's GitHub login:

| What | Call |
|---|---|
| PR metadata (`PrMetadata`, with `url` and the head SHA) | `GET /repos/{o}/{r}/pulls/{n}` |
| Merge base (the base side of file reads) | `GET /repos/{o}/{r}/compare/{base}...{head}?per_page=1&page=2` (the file list is only on page 1, so page 2 is about 14 KB instead of MBs) |
| The diff (source B), read once | `GET /repos/{o}/{r}/pulls/{n}` with `Accept: application/vnd.github.diff` |
| File bytes (source C), on demand | `GET /repos/{o}/{r}/contents/{path}?ref={sha}` with `Accept: application/vnd.github.raw+json` |

- **Only the PR's own files** are read: the paths in its diff, the same set as
  `allowedPaths` of the resolved review (resolution keeps every diff file).
  Path segments are URL-encoded one by one; empty, `.` and `..` segments are
  refused. Owner, repo and number are checked before they go into a URL.
- A renamed file is read under its old name on the base side. Binary files,
  the base of an added file and the head of a deleted file are `""` without a
  call. A 404 or a file over 10 MB is `""` (unavailable). Other errors (rate
  limit, 5xx) are thrown, not shown as an empty file.
- **Never a partial diff.** GitHub refuses the diff of a very large PR (406,
  code `too_large`, for example more than 300 files): that is a
  `PrTooLargeError` with a clear message (US-19 adds a local clone for these).
  Also, the diff's file count and line totals must equal the PR's
  `changed_files` / `additions` / `deletions`, or it is an
  `IncompleteDiffError` (the PR changed while loading, or the diff was cut).
  Checked on 5 real diffs of this repo (4 to 88 files, with renames): core's
  `parseDiff` counts match GitHub's exactly.

**Try it on a real PR** (uses the app's GitHub login; prints one JSON line):

```bash
pnpm --filter desktop exec electron-vite dev -- --pr-check=owner/repo#123
release/linux-unpacked/review-buddy --pr-check=https://github.com/owner/repo/pull/123
```

It prints the PR title, the two SHAs, the diff's size and counts, and the
lengths of one file read on both sides, or the error (`errorKind`:
`too_large`, `incomplete` or `other`).

**Tests** run on recorded GitHub responses (`src/main/github/fixtures/`, see
its README), with no network. The recording session could only reach this
repo, which has no PRs, so the diff, merge base, contents and 404 were
recorded from the same commits through `compare` and `contents`. The PR JSON
and the 406 body follow GitHub's documented shapes.

## Reviewing a PR (the agent)

Start reviews from the PR list, or type `owner/repo#123` or a PR URL in the
top bar and press **Review**. Or start the app with
`--review-pr=owner/repo#123`:

```bash
pnpm --filter desktop dev -- --review-pr=owner/repo#123
```

Each review is a job in main (`src/main/agent/review-job.ts`). **Two run at
a time** (`MAX_RUNNING`: each is a Claude Code process); the others wait and
start in the order they were queued. A PR that is already queued or running
cannot be queued again. Main keeps the last 20 finished jobs for the
renderer, and every review in its store.

**Progress events.** Main sends the whole job list to the page on every
change (`review:jobs-changed`, at most every 100 ms); the renderer does not
poll. Each running job has a **phase**:

| Phase | What happens | Steps you see |
|---|---|---|
| `github` | main reads the PR, its merge base and its diff | "Loading owner/repo#1 from GitHub" |
| `reading` | Claude starts and reads the diff and files | "Reading the diff (part 1 of 2)", "Reading src/a.ts" |
| `writing` | Claude writes the `submit_review` call | "Writing chapter 2: <its title>" |
| `checking` | the app resolves the chapters' anchors against the diff | "Review submitted with 1 resolution note(s)" |

"Writing" is seen live: the run asks the SDK for streamed output
(`includePartialMessages`) and reads the chapter titles from the
`submit_review` input while Claude writes it. The review tab shows the four
phases, the current step, the time, and all steps on demand. If Claude
resubmits after resolution notes, the phase goes back to "writing".

**Stop** cancels the GitHub requests and the Claude run, and a stopped run
shows no review, even if Claude had already submitted one; on a queued job it
takes it out of the queue.

**Failures** say what failed (`errorKind`), with the reason and, when it
helps, what to do:

| Kind | When | Title |
|---|---|---|
| `github` | not signed in, not found, no access, GitHub unreachable, a diff that does not match the PR | "Could not read owner/repo#1 from GitHub" |
| `too-large` | GitHub sends no diff (406 `too_large`) | "owner/repo#1 is too large for the GitHub API" |
| `claude` | Claude Code cannot start, or Claude reports an error code: not signed in (`authentication_failed`: "Run `claude /login`"), billing, rate limit, overloaded, … | "Claude could not review owner/repo#1" |
| `agent` | Claude ran but no review came out (out of turns, timed out, gave up) | "Claude did not finish the review of owner/repo#1" |
| `stopped` | you pressed Stop | "The review of owner/repo#1 was stopped" |

**Try again** starts the same PR as a new job and follows it (not offered
for "too large": it would fail the same way). The console gets
one `[review-buddy] review-run {…}` line per run, with the turns, cost and
number of resolution notes.

**What the agent can do** (`src/main/agent/runner.ts`). Agent SDK `query()`
with the desktop prompt (`packages/core/prompts/review-desktop.md`) as the
system prompt, and three tools from an in-process MCP server
(`src/main/agent/review-tools.ts`):

| Tool | What it does |
|---|---|
| `get_pr_diff` | The PR's metadata and its diff. A large diff comes in parts of at most 40k characters (Claude Code cuts MCP output at about 25k tokens), split at files, then hunks; the parts join back to the exact diff. |
| `read_file` | One of the PR's files at the head or the base, with line numbers, in windows. A line over 2,000 characters (minified code) is cut, with a note. Other paths are refused. |
| `submit_review` | `validateAgentReview` → `resolveReview` against the same diff string, then answers with the resolution notes so the agent can fix its anchors. At most 3 submissions (the first + 2 fixes, as the prompt says); the app shows the last one. |

Nothing else: `tools: []` turns off every built-in tool (no shell, no file
read or write, no web), only the three tools are allowed (`permissionMode:
"dontAsk"`), no settings files are read (`settingSources: []`, so no
CLAUDE.md, hooks or your own MCP servers), and it runs in a temp folder with
no saved session. The input schema of `submit_review` is the shared
`review.schema.json` without `cwd` and `source`. The SDK's `tool()` takes zod,
so it is converted with `z.fromJSONSchema`; a test checks that the schema the
agent sees is the shared one.

The PR's metadata and diff are read **before** Claude starts, so a PR that is
too large for the API fails without spending tokens.

**End-to-end check with the real agent** (not in CI: it costs one review):

```bash
pnpm --filter desktop review-e2e        # on Linux without a display: under xvfb-run -a
node scripts/review-e2e.ts --executable release/linux-unpacked/review-buddy   # packaged
```

It fakes GitHub inside main with the recorded PR #28 of this repo (and file
bytes from this repo's git history), picks the repo, presses **Review** on
#28 in the PR list, waits for the agent, and checks that the Prologue and
every chapter show, that "expand full file" shows a line far from the hunks,
and that the PR list then shows #28 as **Reviewed**. It also checks that the
streamed "Writing chapter 1: …" step came. It passed in dev and in a
packaged Linux build: about 15–25 s, 4 turns, a few cents, no resolution
notes. Use `--screenshots <dir>` to keep two screenshots.

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
  imports only Node built-ins, and they are not packaged. The review tools
  (US-12) use zod themselves; it is a devDependency, so it is bundled into
  main like core.

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
