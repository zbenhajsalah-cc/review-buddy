#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for Review Buddy.
#
# Layers:
#   1. Bun toolchain, pinned by .bun-version (shared with CI's setup-bun).
#   2. pnpm, pinned by package.json "packageManager" (shared with CI).
#   3. Workspace dependencies (backend + viewer), frozen to pnpm-lock.yaml.
#
# The viewer and plugin ship prebuilt in apps/plugin/{ui/dist,dist}
# (committed), so there is no build
# step here. Safe to run repeatedly and against a cached/partial home.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUN_VERSION="$(tr -d '[:space:]' < "$REPO_ROOT/.bun-version")"

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

# --- 2. pnpm ----------------------------------------------------------------
PNPM_SPEC="$(node -p 'require(process.argv[1]).packageManager' "$REPO_ROOT/package.json")"
if ! command -v pnpm >/dev/null 2>&1 || [ "pnpm@$(pnpm --version 2>/dev/null)" != "$PNPM_SPEC" ]; then
  echo "[install] Installing ${PNPM_SPEC}…"
  npm install -g "$PNPM_SPEC"
fi

# --- 3. Dependencies --------------------------------------------------------
# One install covers the workspace: the plugin (apps/plugin: MCP server +
# PreToolUse hook), its viewer (apps/plugin/ui: Vite + React 19 + Tailwind v4),
# and the shared review logic (packages/core).
(cd "$REPO_ROOT" && pnpm install --frozen-lockfile)

echo "[install] Done."
