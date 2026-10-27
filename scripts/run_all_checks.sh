#!/usr/bin/env bash
# Kabul Cargo — run every check (backend scripts, frontend static checks, all E2E suites).
#   scripts/run_all_checks.sh [--skip-e2e] [--only NAME ...]
# The work is done by run_all_checks.py (same logic on Windows and Linux); see its docstring.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
for candidate in "$root/.venv/bin/python" "$root/.venv/Scripts/python.exe"; do
  if [ -x "$candidate" ]; then exec "$candidate" "$root/scripts/run_all_checks.py" "$@"; fi
done
echo "virtualenv not found under $root/.venv" >&2
exit 2
