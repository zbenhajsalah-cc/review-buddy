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

### MCP server "failed to connect", or the hook doesn't fire (`node: command not found`)

The MCP server and the `PreToolUse` hook both run the committed bundle
`dist/cli.mjs` on **Node ≥ 20.11** (see `.claude-plugin/plugin.json` and
`hooks/hooks.json`). Claude Code launches them with `command: "node"`, so if
`node` isn't resolvable on the `PATH` of the process that started Claude Code,
the server never comes up and shows as failed to connect.

**Most common cause — a stale `PATH`.** A version manager (nvm, fnm, volta,
asdf) puts `node` on the `PATH` of *new* shells only; a process that's already
running keeps the `PATH` it started with. Claude Code — and every child it
spawns — inherits that stale `PATH`, so it can't find `node` even though a new
terminal can.

**Fix:**

1. **Fully quit Claude Code and close the terminal it was launched from.**
   Reloading plugins inside the old session is not enough — the stale `PATH` is
   already baked into the running process.
2. Open a **brand-new** terminal and confirm Node resolves at a supported
   version:
   ```
   node --version
   ```
   If that prints `v20.11` or newer, start Claude Code from this fresh terminal
   and the MCP server will connect.
3. GUI-launched apps (Dock, Start menu) often don't see a version manager's
   `PATH` at all. Either launch Claude Code from a terminal, or install a
   system-wide Node (the [nodejs.org](https://nodejs.org) installer, `brew
   install node`, or your distro's package) so `/usr/local/bin/node` exists for
   every process.
4. On Node older than 20.11 the server starts and then fails on
   `import.meta.dirname` — upgrade rather than pinning back.

### `npx review-buddy` can't reach the network (Cursor / Copilot / Codex)

`npx -y review-buddy@latest` downloads the package on first use and caches it.
In an offline or proxied environment that first launch fails. Install it once
while you have network access:

```bash
npm install -g review-buddy
```

then change the MCP config's `command` to `review-buddy` with
`args: ["mcp", "--standalone"]` — no network needed at launch.

---

## Runtime

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
