#!/usr/bin/env bash
# Bundles src/* into the single self-contained index.html at repo root.
# Run after any change under src/, before committing or publishing.
#
# Usage:
#   ./build.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$ROOT/tools/build.py"
