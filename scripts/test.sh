#!/usr/bin/env bash
# Run the unit tests with the project-local Node. Extra arguments go to `node --test`.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="$ROOT/.tools/node/bin/node"

[[ -x "$NODE" ]] || { echo "Local Node not found. Run scripts/setup-node.sh first." >&2; exit 1; }

cd "$ROOT"
exec "$NODE" --test "$@" "tests/**/*.test.js"
