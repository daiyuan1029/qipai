#!/usr/bin/env bash
# ── RLCard Web Testing App — Startup Script ────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBAPP_DIR="$SCRIPT_DIR/webapp"

echo "======================================"
echo "  RLCard Web Testing App"
echo "======================================"

# 1. Install Python dependencies
echo "[1/3] Installing Python dependencies..."
pip install -q -r "$WEBAPP_DIR/requirements.txt"

# 2. Make sure rlcard-master is extracted
if [ ! -d "$SCRIPT_DIR/rlcard-master" ]; then
  echo "[2/3] Extracting rlcard-master.zip..."
  cd "$SCRIPT_DIR" && unzip -q rlcard-master.zip
else
  echo "[2/3] rlcard-master already extracted."
fi

# 3. Start server
echo "[3/3] Starting server on http://localhost:8000"
echo "--------------------------------------"
echo "  Open: http://localhost:8000"
echo "  Stop: Ctrl+C"
echo "--------------------------------------"

cd "$WEBAPP_DIR"
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
