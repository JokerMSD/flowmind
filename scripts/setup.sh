#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Preparando o FlowMind..."
corepack pnpm install

echo "FlowMind pronto."
echo "Execute: npm run start"
