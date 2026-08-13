#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for Review Buddy.
#
# Layers:
#   1. Bun toolchain, pinned to package.json "packageManager" (and CI's setup-bun).
#   2. Backend + viewer dependencies, frozen to the committed lockfiles.
#
# The viewer ships prebuilt in src/ui/dist (committed), so there is no build
# step here. Safe to run repeatedly and against a cached/partial home.
set -euo pipefail

BUN_VERSION="1.3.5"

# --- 1. Bun -----------------------------------------------------------------
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

if ! command -v bun >/dev/null 2>&1 || [ "$(bun --version 2>/dev/null)" != "$BUN_VERSION" ]; then
  echo "[install] Installing Bun v${BUN_VERSION}…"
  curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"
fi

# Expose bun to every shell (install/start/terminals/agent) regardless of
# whether ~/.bashrc is sourced, by symlinking into a directory already on PATH.
if command -v sudo >/dev/null 2>&1 && [ -w /usr/local/bin -o -n "$(sudo -n true 2>/dev/null && echo x)" ]; then
  sudo ln -sf "$BUN_INSTALL/bin/bun" /usr/local/bin/bun || true
  sudo ln -sf "$BUN_INSTALL/bin/bunx" /usr/local/bin/bunx || true
fi

echo "[install] Using $(bun --version) at $(command -v bun)"

# --- 2. Dependencies --------------------------------------------------------
# Backend: the MCP server + PreToolUse hook (@modelcontextprotocol/sdk, zod).
bun install --frozen-lockfile
# Viewer: Vite + React 19 + Tailwind v4 package.
bun install --frozen-lockfile --cwd src/ui

echo "[install] Done."
