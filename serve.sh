#!/usr/bin/env bash
# Serves the repo locally for development.
#
# Usage:
#   ./serve.sh [port]        (default port 8123)
#
# Then open:
#   http://localhost:<port>/src/index.html            — editable source (dev loop)
#   http://localhost:<port>/build/artifact/index.html  — bundled build output (run ./build.sh first)
#
# Ctrl+C to stop. See AGENTS.md for the full edit/build/publish workflow.
set -euo pipefail

PORT="${1:-8123}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "Serving $ROOT at:"
echo "  http://localhost:$PORT/src/index.html            (source)"
echo "  http://localhost:$PORT/build/artifact/index.html  (bundled, run ./build.sh first)"
echo "Ctrl+C to stop."
exec python3 -m http.server "$PORT"
