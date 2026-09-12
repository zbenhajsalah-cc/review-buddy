# Troubleshooting

Common install and runtime issues, and how to resolve them. If your problem isn't
here, open an issue with the exact error text and your OS.

---

## Install

### Windows: `EPERM: operation not permitted, rename ... -> ...\cache\review-buddy\review-buddy\<version>`

```
Failed to install: EPERM: operation not permitted, rename
'C:\Users\<you>\.claude\plugins\cache\temp_local_..._xxxx'
-> 'C:\Users\<you>\.claude\plugins\cache\review-buddy\review-buddy\0.2.0'
```

This comes from **Claude Code's plugin installer**, not from Review Buddy. The
installer unpacks the plugin into a temp folder and then `rename`s it into the
versioned cache path. On Windows that `rename` throws `EPERM` when the
destination already exists, or when a file inside the folder is momentarily
locked by another process. It is usually **transient**.

**Fix, most-likely first:**

1. **Retry the install.** The lock is often a background scan (Windows Defender,
   Search indexer, OneDrive) holding a handle for a fraction of a second. Running
   `/plugin install` again a time or two clears it in most cases.

2. **Clear a stale cache folder.** A partial folder left by an earlier failed
   attempt makes the `rename` fail every time (Win32 won't overwrite an existing
   directory). Delete it and retry:
   ```powershell
   Remove-Item -Recurse -Force "$env:USERPROFILE\.claude\plugins\cache\review-buddy"
   ```

3. **Exclude the cache dir from antivirus.** If retries keep failing, Defender is
   likely the one holding the handle:
   ```powershell
   Add-MpPreference -ExclusionPath "$env:USERPROFILE\.claude"
   ```

4. **Check OneDrive.** If your user profile (and thus `.claude`) is synced by
   OneDrive, it locks files mid-sync. Pause OneDrive and retry, or confirm
   `%USERPROFILE%` isn't being redirected/backed up.

5. **Run the terminal as Administrator** and reinstall — last resort if a
   permission (not a lock) is the real cause.

### MCP server "failed to connect", or the hook doesn't fire (`bun: command not found`)

The MCP server and the `PreToolUse` hook both run on **Bun** (see
`.claude-plugin/plugin.json` and `hooks/hooks.json`). Node is not a substitute —
the code uses Bun-specific APIs. Claude Code launches the MCP server with
`command: "bun"`, so if `bun` isn't resolvable on the `PATH` of the process that
started Claude Code, the server never comes up and shows as failed to connect.

**Most common cause — Bun was just installed and the `PATH` is stale.** The Bun
installer adds `bun` to your user `PATH`, but a process that's already running
keeps the `PATH` it started with. Claude Code (and every child it spawns) inherits
that stale `PATH`, so it can't find `bun` — even though a *new* terminal can.

**Fix:**

1. **Fully quit Claude Code and close the terminal it was launched from.**
   Reloading plugins inside the old session is not enough — the stale `PATH` is
   already baked into the running process.
2. Open a **brand-new** terminal and confirm Bun resolves:
   ```
   bun --version
   ```
   If that prints a version, start Claude Code from this fresh terminal and the
   MCP server will connect.
3. If `bun` is still "not recognized" in a new terminal, the installer's `PATH`
   change hasn't propagated — sign out/in of Windows (or reboot), then retry.
4. Make sure Bun is actually installed (≥ 1.3): the
   [Windows installer](https://bun.sh), or `curl -fsSL https://bun.sh/install | bash`
   on macOS/Linux.

---

## Runtime

### Agent Plugin: `submit_review` says it can't locate the repository

Outside Claude Code the MCP server runs **standalone**: its working directory
is the plugin install dir, not your project. The repo location comes from the
review's `cwd` field — the skill tells the agent to pass
`git rev-parse --show-toplevel`. If it skipped that, you get either

- "Could not locate the repository: pass the repo root in the review's `cwd`
  field…", or
- "…resolves to `<path>`, which is the repo hosting the Review Buddy package —
  not your project's repo." — deliberate: the plugin dir sits inside a git
  repo and the ambient fallback refused to silently review the host.

Both mean the same thing: ask the agent to run `git rev-parse --show-toplevel`
and pass the result as `cwd`. On clients that can inject env into MCP servers,
`REVIEW_BUDDY_CWD` is the fallback. (The `bun: command not found` cause above
applies to the plugin's `mcp.json` too — it also launches `bun`.)

### The browser tab doesn't open

Opening the browser is best-effort (`src/server/browser.ts`). If it fails (headless
environment, no default browser, sandbox), the hook **prints the review URL** to
the terminal instead — open it manually. The URL is loopback-only and carries a
per-server token:

```
http://127.0.0.1:<port>/?token=<token>
```

### Reviewing a PR — "expand full file" shows nothing

When you review a GitHub PR whose branch **isn't checked out** (`/review 42`), the
diff renders fully, but "expand full file" needs the surrounding file bytes on
disk — which aren't there for a branch you haven't fetched. This is expected; the
diff hunks themselves are unaffected. Check the branch out locally if you need
full-file expansion.

### `/review 42` fails to capture a PR

Reviewing a GitHub PR shells out to the **GitHub CLI**. Make sure:

- `gh` is installed and on your `PATH`, and
- you're authenticated (`gh auth status`).

The local working-tree flow (`/review` with no argument) only needs `git`.

### The hook seems to hang

That's by design. The `PreToolUse` hook **blocks the agent's turn** while you
review (long timeout), so Claude Code waits until you click **Done** in the
browser tab. Closing the tab without clicking Done leaves the turn blocked until
the timeout — click **Done** to release it.
