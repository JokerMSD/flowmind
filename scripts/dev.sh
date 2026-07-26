#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Iniciando FlowMind..."
echo "Editor: http://localhost:3000"
echo "API:    http://localhost:3001"
echo "Use Ctrl+C para encerrar."
echo

corepack pnpm start
