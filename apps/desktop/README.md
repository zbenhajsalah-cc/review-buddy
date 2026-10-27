# Review Buddy desktop (Electron)

The desktop app shows a review in the same viewer as the plugin
(`@review-buddy/viewer`), and gets its data from Electron main over IPC
instead of HTTP. Plan and stories: `docs/DESIGN-desktop-app-shared-code.md`,
`docs/backlog-desktop-app.md`.

**Status (US-08 to US-17):** the app opens on your GitHub repositories (see
"Repositories"). Pick one to see its open PRs (see "Pull requests") and
review one or several of them (or type any `owner/repo#123` or PR URL in the
top bar): main reads each PR from the GitHub API (see "Reading a PR"), Claude
reviews it with your Claude login (see "Reviewing a PR"), and the viewer
shows the result. You see each review's progress as it runs, can stop it,
and can try again after a failure. The "Sample review" tab shows a fixed review
(`src/main/fixture/review.json`) until you follow a review. The settings view
connects GitHub (see "GitHub login"). Finished reviews are saved, so a PR
reviewed before opens at once, also after a restart; your viewed files and
**Done** are kept too (see "Saved reviews").

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
pnpm --filter desktop dist     # installer for this OS in release/ (see "Install the app")
```

The root has the same commands as `pnpm dev:desktop`, `build:desktop`,
`smoke:desktop`, `test:desktop`, `typecheck:desktop` and `dist:desktop`. `verify:ci` runs the
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

## Install the app

Build the installer on the computer you install on:

```bash
pnpm install
pnpm --filter desktop dist      # or, from the root: pnpm dist:desktop
```

| OS | File in `apps/desktop/release/` | Install |
|---|---|---|
| macOS | `review-buddy-<version>-arm64.dmg` (and a `.zip`; `x64` on Intel) | Open the `.dmg`, drag **Review Buddy** to Applications. |
| Windows | `review-buddy-<version>-x64.exe` | Run it: it installs for your user (no admin) and adds a Start menu entry. |
| Linux | `review-buddy-<version>-x86_64.AppImage` | `chmod +x` it and run it. It needs FUSE 2 (`sudo apt install libfuse2` on Ubuntu 22.04+); without it, run it with `--appimage-extract-and-run`. |

**Before the first review**, on that computer:

- **Claude Code:** install it and log in once (`claude /login` in a
  terminal). The app runs your installed Claude Code (US-21), with that
  login; it must be at least the version of the app's Agent SDK (see
  "Claude Code" below). Check it with `--agent-check` (below).
- **GitHub:** nothing if `gh auth login` was done; otherwise paste a token in
  the app's settings (see "GitHub login").

**No code signing** (personal use; the story allows it):

- **macOS:** the app is signed *ad hoc* (`identity: "-"` in
  `electron-builder.yml`), which Apple Silicon needs to run it, without the
  hardened runtime (only notarization needs it). A build made on the same Mac
  opens normally. A copy downloaded or moved from another Mac is
  quarantined: right-click → **Open** once, or
  `xattr -dr com.apple.quarantine "/Applications/Review Buddy.app"`.
- **Windows:** SmartScreen may say "Windows protected your PC": **More
  info** → **Run anyway**.
- **Linux:** AppImages are not signed.

**Check a packaged app** from a terminal (the same flags as in dev):

```bash
"/Applications/Review Buddy.app/Contents/MacOS/Review Buddy" --agent-check   # macOS
release/review-buddy-<version>-x86_64.AppImage --agent-check                 # Linux
# The same app path also takes:
#   --pr-check=owner/repo#123    reads a real PR with the app's GitHub login
#   --review-pr=owner/repo#123   opens the app and reviews that PR
```

**Your data** (GitHub token, settings, saved reviews, viewed files) is in the
app's profile folder, kept across reinstalls and updates:
`~/Library/Application Support/Review Buddy` (macOS),
`%APPDATA%\Review Buddy` (Windows), `~/.config/Review Buddy` (Linux). To
update, build again and reinstall.

**Linux sandbox note.** electron-builder starts AppImages with
`--no-sandbox`: an AppImage cannot ship Chromium's setuid sandbox helper.
The renderer still has no Node access (`sandbox: true` in its web
preferences), but it loses the OS-level sandbox. For the full sandbox, run
the unpacked app instead (`pnpm --filter desktop package`, then
`sudo chown root release/linux-unpacked/chrome-sandbox && sudo chmod 4755
release/linux-unpacked/chrome-sandbox`, then run
`release/linux-unpacked/review-buddy`).

**Size.** Without a Claude Code copy inside (US-21), the Linux AppImage is
about 129 MB (it was about 243 MB with it). Most of the rest is Electron.

**What was checked (US-18).** On Linux (x64, in a container), the AppImage
built by `pnpm dist` passed the smoke test
(`node scripts/smoke-desktop.ts --executable release/review-buddy-…AppImage`),
`--agent-check`, and the real-agent review (`review-e2e --executable …`):
the review, a restart, the saved review and "expand full file". Its menu entry
and icon are in place. **The macOS and Windows installers were not built
here** (they must be built on those systems); their settings follow
electron-builder's documented options for unsigned builds. The real GitHub
login (gh or a pasted token) in a packaged app needs a real machine: the
container's GitHub access is limited to one repository.

The icon is `build/icon.svg`, rendered to `build/icon.png` (1024 px);
electron-builder makes the `.icns` and `.ico` from the PNG.

## Layout

```
src/main/       # Electron main (Node): window, app:// protocol, IPC handlers, review store + saved reviews
src/main/agent/ # Agent SDK: the installed Claude Code (find + version check), --agent-check, the review tools, runner and job
src/main/github/ # GitHub login (gh CLI token, pasted token in safeStorage), repo and PR lists, GitHubApiSource
src/preload/    # exposes window.reviewBuddy = { review, github, claude }; built as CommonJS
src/renderer/   # App shell (top bar, tabs) + repo and PR lists + <ReviewViewer api={ipcReviewApi(...)} /> + settings (GitHub, Claude Code, saved reviews)
src/shared/     # the IPC contract (channel names + types), used by all three
scripts/        # smoke-desktop.ts (no Claude), review-e2e.ts (the real agent)
electron-builder.yml  # packaging: installers per OS, without the SDK's Claude Code binary
build/          # icon.svg → icon.png (the app icon)
```

## Security

The renderer shows text from PRs and from the agent, so it is treated as
untrusted:

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The
  preload exposes eleven review calls (one of them the job-list event) and
  seven GitHub calls, never `ipcRenderer` itself. (On Linux, the AppImage
  runs without the OS-level sandbox: see "Install the app".)
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
  current login, so a repo that login cannot see is not shown. A review that
  opens a repo not first in the list (from the top bar, say) makes the list
  read them again, without a Refresh.
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
- **What the app has for each PR:** **Reviewed** (a saved review of the
  PR's current head, with **Open review**, and **Run again** for a new
  run), **Outdated review** (the PR has new commits since; **Open review**
  or **Review again**), **Queued** (with **Remove**), **Reviewing…** (with
  **Show progress**), or "Last review failed: …" with the reason. While a
  review runs, the row shows its phase and time. See "Saved reviews".
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

## Saved reviews

Every finished review is saved (`src/main/review-cache.ts`), so opening a PR
again costs no agent run, also after a restart:

```
<userData>/reviews/index.json                          what is saved
<userData>/reviews/<owner>/<repo>/<number>@<headSha>.json   one review
```

A review file holds the resolved review, the PR head and merge base SHAs,
and the diff's file list (names, renames, binary). That is all "expand full
file" needs after a restart: it reads the files from GitHub at those SHAs,
for that file list only. File names are built only from checked parts
(owner, repo, number, SHA); the renderer names a review by its key, which is
looked up in the index. A missing or damaged file is dropped.

- **One review per PR head.** Reviewing the same head again replaces it.
- **Opening a PR:** **Open review** on a **Reviewed** row shows the saved
  review at once. Starting a review of a PR (from the list or the top bar)
  whose current head has a saved review opens that review instead of running
  Claude ("Opened the saved review of this commit"); **Run again** on the
  row forces a new run.
- **Out of date:** when the PR's head moved since its newest saved review,
  the row says **Outdated review**. Opening it shows a bar: "This review is
  for an older commit … has new commits since", with **Review again**.
- **Deleting:** Settings → **Saved reviews** lists them (PR, title, commit,
  when, size, done) with **Delete** each and **Delete all** (asked twice). A
  deleted review disappears from the PR list and from the jobs list, and its
  viewed files are forgotten.

**Viewed files and Done (US-17).** The viewer keeps viewed / collapsed files
in the page's `localStorage`, keyed by the review key; for the app's own
`app://renderer` origin that lives in the profile and survives a restart.
The plugin clears that state on **Done** (the review is over); the app keeps
it (`ReviewApi.afterDone: "keep"`): the review stays open, the button shows
**Done ✓**, and you can come back to it. **Done** is saved with the review
(`doneAt` in the index): the PR list shows **Done ✓** instead of
**Reviewed**, and the review opens with "You marked this review done …".
Viewed files and Done belong to the commit: reviewing the same commit again
(**Run again**) replaces only Claude's text and keeps both. **Done ✓** stays
on every chapter of the open review.

**Tests:** `review-cache.test.ts` (save, reload, newest, replace, delete,
damaged or missing files, an index entry that points outside the folder,
unsafe names); `reviews.test.ts` (a store reloads a saved review, with its
file reads, after a "restart"). The smoke test writes two saved reviews into
its profile before launch, in the saved format, and checks Reviewed /
Outdated, Open review, the banner, the no-run reopen, Delete and Delete all.
`review-e2e` marks a file viewed and presses **Done**, restarts the app, and
checks the PR is still done, the review opens with the file still viewed,
"expand full file" works, and no agent ran.

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
takes it out of the queue. Once the review is being saved, Stop is too late
(like Stop on a finished job): that save may replace a saved review of the
same commit (**Run again**), and undoing it would lose that one and its Done.

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
production `dependency`). The SDK runs Claude Code as a child process: your
installed `claude` (US-21, below). Claude Code uses the login you already
have from `claude /login`. It reads it from `~/.claude` on Linux and
Windows, and from the Keychain on macOS. No API key is needed.

### Claude Code (US-21)

The app does not ship Claude Code: it runs the one you installed
(`src/main/agent/claude-code.ts`).

- **Finding it.** The PATH first, then the usual install folders:
  `~/.local/bin`, `~/.claude/local`, `/opt/homebrew/bin`, `/usr/local/bin`
  (Windows: `claude.exe` in the PATH and `%USERPROFILE%\.local\bin`). An app
  started from the Dock or the Start menu does not get the shell's PATH,
  which is why the folders are searched too. Relative PATH entries (`.`,
  `node_modules/.bin`) are skipped: the review runs Claude Code in another
  folder, where they point elsewhere. Elsewhere: Settings →
  **Claude Code** → **Choose…** (a file dialog in main; the path is kept in
  `settings.json` as `claudePath`, and only that binary is checked).
  **Search for it instead** forgets it. On Windows, choose `claude.exe`: an
  npm `.cmd` shim cannot be started without a shell.
- **Version.** `claude --version` (`2.1.311 (Claude Code)`) must be at least
  the Claude Code version of the app's Agent SDK (`claudeCodeVersion` in the
  SDK's package.json, read at build time: `src/main/agent/sdk-version.ts` →
  `__CLAUDE_CODE_MIN_VERSION__`). Newer versions are accepted, with no upper
  limit: Claude Code updates itself often. If several are found, the first
  one that is new enough is used.
- **When it is checked.** At start, on **Check again**, and before each
  Claude run (a `claude` updated or removed while the app is open). Opening
  a saved review needs no Claude Code.
- **When it is missing, too old or broken,** a bar above every screen says
  why ("Claude Code 2.1.200 is too old for this app (needs 2.1.296 or
  newer). Run `claude update`, then press Check again."), with a button to
  the settings, and the Review buttons are off with the same reason. A
  review that fails the check before its run ends with the `claude` error
  kind and that message. The Settings card shows the path, the version, the
  state, and where the app looked; when nothing is found it links to the
  install page.
- **A failed run** names the Claude Code it used: "(Claude Code 2.1.311,
  /path/to/claude)".
- **`--agent-check`** reports `claudePath` and `claudeCodeVersion`.

**What was checked (US-21).** On Linux: unit tests with fake `claude`
scripts (found, missing, too old, an old one before a new one, another
program, failing, not executable, a chosen one, a chosen one that is gone);
the smoke test with a fake `claude` chosen in the settings (too old: the bar
and the disabled Review; after an "update" and **Check again**: ok); and the
installed Claude Code 2.1.311 with SDK 0.3.296 (its own version: 2.1.296):
`--agent-check` and the real-agent review e2e, in dev and in the AppImage.
Not checked here: macOS and Windows, a Claude Code older than the SDK's
version (refused by design, not tried), and the native installer's folders
on a real machine.

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

- **No Claude Code inside.** The SDK brings its own Claude Code binary in an
  optional per-platform package (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>`,
  about 246 MB). Until US-18 the app shipped it (unpacked from `app.asar`,
  where it cannot run). Since US-21 `electron-builder.yml` leaves those
  packages out and main passes the installed `claude` as
  `pathToClaudeCodeExecutable` (see "Claude Code" below).
- **The SDK must stay external** (a `dependency`, not bundled).
  electron-builder collects it from pnpm's layout. **No
  `node-linker=hoisted` is needed.** It warns that the other platforms'
  packages are not bundled; that is expected.
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
one external package (without its platform binary, US-21) from pnpm's
symlinked layout (the default `node-linker=isolated`).

This is why every other package is a devDependency: electron-vite keeps only
`dependencies` external.

Still to do in US-18: icons, installers (dmg / AppImage / NSIS), signing.
