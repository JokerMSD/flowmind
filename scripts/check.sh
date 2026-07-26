#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

npm run check

echo "Para o smoke test, inicie ./scripts/dev.sh e rode: corepack pnpm smoke:execute"
