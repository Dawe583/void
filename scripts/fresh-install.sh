#!/usr/bin/env bash
# fresh-install.sh - clean VOID install from lockfile plus first hold moment.
#
# Usage:
#   ./scripts/fresh-install.sh        run from anywhere; script cds to repo root
#   bash scripts/fresh-install.sh     same, via explicit shell
#
# What it does:
#   Step 1: check prereqs (node >= 24, pnpm with corepack fallback).
#   Step 2: pnpm install --frozen-lockfile from the repo root.
#   Step 3: run node scripts/src/moment.mjs (prints the hold lines itself)
#           timed with SECONDS, then print FIRST HOLD REACHED IN <N>s.
#
# Expected time: well under five minutes on a warm network. Cold cache or
# slow network can take longer; the moment script itself runs in seconds.
#
# Exit codes:
#   0  success: install finished and the moment script passed.
#   1  prereq failure (node missing or major < 24, pnpm missing and corepack
#      fallback failed), install failure, or moment script failure.
set -euo pipefail

# Step 1: prereqs.
if ! command -v node >/dev/null 2>&1; then
  echo "error: node is not installed or not on PATH (need node >= 24)" >&2
  exit 1
fi
node_version="$(node --version)"
node_major="${node_version#v}"
node_major="${node_major%%.*}"
if ! [[ "$node_major" =~ ^[0-9]+$ ]] || [ "$node_major" -lt 24 ]; then
  echo "error: node >= 24 is required (found $node_version)" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found, trying corepack fallback..." >&2
  if ! corepack enable && corepack prepare pnpm@10.33.0 --activate; then
    echo "error: pnpm is not installed and corepack fallback failed (need pnpm@10.33.0)" >&2
    exit 1
  fi
fi

# Step 2: install from the repo root.
script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
cd "$repo_root"
# Non-interactive: pnpm may need to purge a stale modules dir (e.g. after a
# Node major change) and refuses to ask without a TTY.
export CI=true
pnpm install --frozen-lockfile

# Step 3: first hold moment, timed.
start="$SECONDS"
node scripts/src/moment.mjs
elapsed=$((SECONDS - start))
echo "FIRST HOLD REACHED IN ${elapsed}s"
