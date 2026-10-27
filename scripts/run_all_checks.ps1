# Kabul Cargo — run every check (backend scripts, frontend static checks, all E2E suites).
#   powershell -ExecutionPolicy Bypass -File scripts\run_all_checks.ps1 [--skip-e2e] [--only NAME ...]
# The work is done by run_all_checks.py (same logic on Windows and Linux); see its docstring.
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { Write-Error "virtualenv not found: $python"; exit 2 }
& $python (Join-Path $PSScriptRoot 'run_all_checks.py') @args
exit $LASTEXITCODE
