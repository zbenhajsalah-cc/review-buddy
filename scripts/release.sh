#!/bin/bash

# release.sh
# Cuts a new Review Buddy release with the version kept in lockstep across every
# file that carries it. This exists because a manual bump once updated
# package.json but left .claude-plugin/plugin.json behind — the kind of drift a
# script should make impossible.
#
# What it does:
# - reads the current version from package.json (the source of truth)
# - computes the next version from a bump keyword (patch/minor/major) or an
#   explicit X.Y.Z you pass in
# - writes that version into every version file
# - verifies every file now agrees
# - commits the bump on develop
# - fast-forwards main to the release commit and tags it v<version> (annotated)
# - pushes develop, main, and the tag to origin in one atomic push
# - creates a GitHub Release for the tag with auto-generated notes (if gh is
#   installed and authenticated; skipped with --no-github or when unavailable)
#
# Release model:
# This repo is linear — work lands on develop and main trails as a
# fast-forwardable master (that is how v0.0.1 was tagged). The script refuses to
# run if main has diverged from develop, so a fast-forward is always safe.
#
# Usage:
#   ./scripts/release.sh <patch|minor|major|X.Y.Z> [options]
#
# Examples:
#   ./scripts/release.sh patch                 # 0.1.0 -> 0.1.1
#   ./scripts/release.sh minor                 # 0.1.0 -> 0.2.0
#   ./scripts/release.sh 1.0.0                 # explicit version
#   ./scripts/release.sh minor --dry-run       # preview, change nothing
#   ./scripts/release.sh patch --yes           # skip the confirmation prompt
#   ./scripts/release.sh patch --no-github     # tag only, no GitHub Release

set -euo pipefail

# Colors are used only for readability in terminal output.
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# On any failure, report where so the repo state can be inspected and recovered.
trap 'echo ""; echo -e "  ${RED}✘ Command failed at line $LINENO: $BASH_COMMAND${NC}"; echo -e "  ${RED}Release stopped. Inspect the repository state before retrying.${NC}"' ERR

DRY_RUN=false
SKIP_CONFIRM=false
USE_GITHUB=true

# Resolve the repo root from the script location so it works from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Every file that carries the release version. package.json is listed first
# because it is the source of truth the current version is read from.
VERSION_FILES=(
  "package.json"
  ".claude-plugin/plugin.json"
  "src/ui/package.json"
  "packages/core/package.json"
)

# Blockers are collected during preflight so a dry run can show them all at once.
BLOCKERS=()

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

# Print a step marker: ○ in dry-run, ✔ in a real run.
step() {
  if is_dry_run; then
    echo -e "  ${BLUE}○${NC} $*"
  else
    echo -e "  ${GREEN}✔${NC} $*"
  fi
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $*"
}

is_dry_run() {
  [ "$DRY_RUN" = true ]
}

# Record a blocker. In dry-run mode blockers are saved for the summary and the
# run continues; in a real run the first blocker stops the script.
handle_blocker() {
  local message="$1"
  if is_dry_run; then
    BLOCKERS+=("$message")
    return 0
  fi
  log_error "$message"
  exit 1
}

show_usage() {
  echo "Usage: $0 <patch|minor|major|X.Y.Z> [options]"
  echo ""
  echo "Version:"
  echo "  patch | minor | major   Bump the current version (read from package.json)"
  echo "  X.Y.Z                    Set an explicit semver version"
  echo ""
  echo "Options:"
  echo "  -n, --dry-run    Print the release steps without changing anything"
  echo "  -y, --yes        Skip the confirmation prompt"
  echo "      --no-github  Push the tag only; do not create a GitHub Release"
  echo "  -h, --help       Show this help message"
  echo ""
  echo "This script will:"
  echo "  1. Verify the tree is clean, on develop, in sync with origin, main fast-forwardable"
  echo "  2. Write the new version into: ${VERSION_FILES[*]}"
  echo "  3. Verify every file agrees, then commit on develop"
  echo "  4. Fast-forward main to the release commit and tag it v<version>"
  echo "  5. Push develop, main, and the tag to origin"
  echo "  6. Create a GitHub Release for the tag with auto-generated notes"
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    log_error "Required command not found: $command_name"
    exit 1
  fi
}

# True when a GitHub Release can be created: gh is installed and authenticated.
# gh resolves the repo from the origin remote itself, so we only gate on auth.
github_available() {
  command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# Version helpers
# ---------------------------------------------------------------------------

# Read a version out of a JSON file's first top-level "version" key.
read_version_from() {
  perl -ne 'if (/"version"\s*:\s*"([^"]+)"/) { print $1; exit }' "$REPO_ROOT/$1"
}

# Given a current X.Y.Z and a bump keyword, echo the next version.
bump_version() {
  local current="$1" kind="$2"
  local major minor patch
  IFS='.' read -r major minor patch <<< "$current"
  case "$kind" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "${major}.$((minor + 1)).0" ;;
    patch) echo "${major}.${minor}.$((patch + 1))" ;;
  esac
}

# Replace the first "version": "..." in a JSON file, preserving all formatting.
# Exits non-zero (caught by set -e) if the key was not found.
write_version_to() {
  local file="$1" version="$2"
  perl -0pi -e 'exit(1) unless s/("version"\s*:\s*)"[^"]*"/${1}"'"$version"'"/' "$REPO_ROOT/$file"
}

# ---------------------------------------------------------------------------
# Confirmation
# ---------------------------------------------------------------------------

confirm_release() {
  if is_dry_run || [ "$SKIP_CONFIRM" = true ]; then
    return 0
  fi
  echo ""
  printf "  Continue? [y/N] "
  read -r answer
  if [[ ! "$answer" =~ ^[Yy]$ ]]; then
    echo "  Release cancelled."
    exit 0
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  local positional_args=()

  while [ $# -gt 0 ]; do
    case "$1" in
      -n|--dry-run) DRY_RUN=true ;;
      -y|--yes) SKIP_CONFIRM=true ;;
      --no-github) USE_GITHUB=false ;;
      -h|--help) show_usage; exit 0 ;;
      --)
        shift
        while [ $# -gt 0 ]; do positional_args+=("$1"); shift; done
        break
        ;;
      -*) log_error "Unknown option: $1"; show_usage; exit 1 ;;
      *) positional_args+=("$1") ;;
    esac
    shift
  done

  if [ "${#positional_args[@]}" -ne 1 ]; then
    log_error "Expected exactly one version argument (patch|minor|major|X.Y.Z)"
    show_usage
    exit 1
  fi

  require_command git
  require_command perl

  cd "$REPO_ROOT"

  # -- Resolve the target version -------------------------------------------

  local current_version
  current_version="$(read_version_from package.json)"
  if [ -z "$current_version" ]; then
    log_error "Could not read current version from package.json"
    exit 1
  fi

  local bump="${positional_args[0]}"
  local version
  case "$bump" in
    patch|minor|major) version="$(bump_version "$current_version" "$bump")" ;;
    *)
      if [[ "$bump" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        version="$bump"
      else
        log_error "Invalid version argument: $bump"
        log_error "Expected 'patch', 'minor', 'major', or an X.Y.Z semver"
        exit 1
      fi
      ;;
  esac

  local develop_branch master_branch
  develop_branch="$(git config --get gitflow.branch.develop || echo develop)"
  master_branch="$(git config --get gitflow.branch.master || echo main)"

  local current_branch tag_name
  current_branch="$(git branch --show-current)"
  tag_name="v${version}"

  # -- Header ---------------------------------------------------------------

  echo ""
  if is_dry_run; then
    echo -e "  ${BOLD}Release ${tag_name}${NC} ${YELLOW}(dry run)${NC}   ${current_version} → ${version}"
  else
    echo -e "  ${BOLD}Release ${tag_name}${NC}   ${current_version} → ${version}"
  fi
  echo ""

  # Show current per-file versions and flag any pre-existing drift.
  local drift=false f fv
  for f in "${VERSION_FILES[@]}"; do
    fv="$(read_version_from "$f")"
    if [ "$fv" != "$current_version" ]; then
      drift=true
      echo -e "  ${YELLOW}⚠ ${f} is at ${fv} (expected ${current_version})${NC}"
    fi
  done
  if [ "$drift" = true ]; then
    echo -e "  ${YELLOW}Version files are out of sync — this release will realign them to ${version}.${NC}"
    echo ""
  fi

  # -- Preflight checks -----------------------------------------------------

  if [ -n "$(git status --porcelain)" ]; then
    handle_blocker "Working tree is not clean"
  fi

  if [ "$current_branch" != "$develop_branch" ]; then
    handle_blocker "Must be on '$develop_branch' (current: $current_branch)"
  fi

  if git rev-parse -q --verify "refs/tags/$tag_name" >/dev/null 2>&1; then
    handle_blocker "Tag already exists: $tag_name"
  fi

  if ! is_dry_run; then
    git fetch origin "$develop_branch" --quiet
    local local_sha remote_sha
    local_sha="$(git rev-parse "$develop_branch")"
    remote_sha="$(git rev-parse "origin/$develop_branch")"
    if [ "$local_sha" != "$remote_sha" ]; then
      handle_blocker "Local '$develop_branch' differs from origin — pull or push first"
    fi
  fi

  # main must be an ancestor of develop so it can fast-forward to the release.
  if git show-ref --verify --quiet "refs/heads/$master_branch"; then
    if ! git merge-base --is-ancestor "$master_branch" "$develop_branch"; then
      handle_blocker "'$master_branch' has diverged from '$develop_branch' — reconcile manually before releasing"
    fi
  fi

  # -- Confirmation ---------------------------------------------------------

  confirm_release

  # -- Execute or preview ---------------------------------------------------

  if is_dry_run; then
    step "Rebuild the committed viewer (src/ui/dist) and stage it with the release"
    step "Write ${version} into ${VERSION_FILES[*]}"
    step "Verify every version file agrees"
    step "Commit on ${develop_branch}: chore(release): ${tag_name}"
    step "Fast-forward ${master_branch} to the release commit"
    step "Tag ${tag_name} (annotated)"
    step "Push ${develop_branch}, ${master_branch}, and ${tag_name} to origin"
    if [ "$USE_GITHUB" = false ]; then
      step "Skip GitHub Release (--no-github)"
    elif github_available; then
      step "Create GitHub Release ${tag_name} (--generate-notes)"
    else
      step "Skip GitHub Release (gh not installed or not authenticated)"
    fi
  else
    # Rebuild the committed viewer so every release ships current bytes. The
    # build is deterministic (content-hashed chunks), so this is a no-op stage
    # when src/ui/dist is already fresh; when UI source moved ahead of the
    # committed artifact, it brings dist up to date (plan 016). `pnpm` is only
    # required for a real release, not for a dry-run preview.
    require_command pnpm
    (cd "$REPO_ROOT" && pnpm install --frozen-lockfile && pnpm build:ui)
    step "Rebuild the committed viewer (src/ui/dist)"

    for f in "${VERSION_FILES[@]}"; do
      write_version_to "$f" "$version"
    done
    step "Write ${version} into ${VERSION_FILES[*]}"

    for f in "${VERSION_FILES[@]}"; do
      fv="$(read_version_from "$f")"
      [ "$fv" = "$version" ] || { log_error "Version mismatch in $f (got $fv)"; exit 1; }
    done
    step "Verify every version file agrees"

    git add "${VERSION_FILES[@]}" src/ui/dist
    if git diff --cached --quiet; then
      log_error "No staged changes — files may already be at $version"
      exit 1
    fi
    git commit -m "chore(release): ${tag_name}" --quiet
    step "Commit on ${develop_branch}: chore(release): ${tag_name}"

    # main is a verified ancestor, so this is a fast-forward (no merge commit).
    git branch -f "$master_branch" "$develop_branch"
    step "Fast-forward ${master_branch} to the release commit"

    git tag -a "$tag_name" -m "$tag_name" "$master_branch"
    step "Tag ${tag_name} (annotated)"

    git push origin "$develop_branch" "$master_branch" "refs/tags/$tag_name" --quiet
    step "Push ${develop_branch}, ${master_branch}, and ${tag_name} to origin"

    # The git release is already pushed, so a GitHub hiccup here must not abort
    # the run — create the Release best-effort and warn (don't exit) on failure.
    if [ "$USE_GITHUB" = false ]; then
      echo -e "  ${YELLOW}○ Skipped GitHub Release (--no-github)${NC}"
    elif ! github_available; then
      echo -e "  ${YELLOW}○ Skipped GitHub Release — gh not installed or not authenticated${NC}"
    elif release_url="$(gh release create "$tag_name" --title "$tag_name" --generate-notes --verify-tag --latest 2>/dev/null)"; then
      step "Create GitHub Release ${tag_name}"
    else
      echo -e "  ${YELLOW}⚠ GitHub Release not created — run: gh release create ${tag_name} --generate-notes${NC}"
    fi
  fi

  # -- Summary --------------------------------------------------------------

  echo ""
  if is_dry_run; then
    if [ "${#BLOCKERS[@]}" -gt 0 ]; then
      echo -e "  ${RED}${#BLOCKERS[@]} blocker(s):${NC}"
      for blocker in "${BLOCKERS[@]}"; do
        echo -e "  ${RED}✘${NC} ${blocker}"
      done
    else
      echo -e "  ${GREEN}No blockers — ready to release ${tag_name}${NC}"
    fi
  else
    echo -e "  ${GREEN}Release ${tag_name} completed${NC}"
    echo -e "  Branches pushed: ${develop_branch}, ${master_branch}"
    echo -e "  Tag: ${tag_name}"
    if [ -n "${release_url:-}" ]; then
      echo -e "  GitHub Release: ${release_url}"
    fi
    echo -e "  ${YELLOW}Note:${NC} the README status line is prose — update it by hand if this release changes what's shipped."
  fi
  echo ""
}

main "$@"
