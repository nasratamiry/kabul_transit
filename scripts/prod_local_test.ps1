# Kabul Cargo — local test of the production Docker stack (stage 15, step 4). Never on a server.
#
#   powershell -ExecutionPolicy Bypass -File scripts\prod_local_test.ps1 [-Keep]
#
# 1. Writes .env.local-test (fresh random secrets, localhost only) and starts the stack from
#    scratch (project "kabulcargo-localtest", its own volumes) with docker-compose.local.yml:
#    nginx on http://localhost:8080, MySQL on 127.0.0.1:3307 for the E2E fixtures.
# 2. MySQL: utf8mb4 + time-zone tables. Django: DEBUG off, 2+ gunicorn workers, Redis cache.
# 3. First super admin (createsuperuser) + seed_statement_lines.
# 4. frontend/scripts/verify-prod.mjs: first branch through the UI, nginx + security headers,
#    documents only via X-Accel, health, throttle shared by the workers.
# 5. Every E2E suite against the stack (scripts/run_all_checks.py --base-url).
# 6. backup_db in the backup container + restore_db --drill.
# Then the stack is removed with its volumes, unless -Keep.
# Output: checks-output\prod-local\ (logs, screenshots, summary.md)
param([switch]$Keep)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$python = Join-Path $root '.venv\Scripts\python.exe'
$out = Join-Path $root 'checks-output\prod-local'
New-Item -ItemType Directory -Force $out | Out-Null
$results = New-Object System.Collections.ArrayList

function Record($name, $ok, $info) {
    [void]$results.Add([pscustomobject]@{ Step = $name; Result = $(if ($ok) { 'PASS' } else { 'FAIL' }); Info = "$info" })
    Write-Host ("  {0}  {1}  {2}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $name, $info)
}

docker info --format '{{.ServerVersion}}' *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Error 'Docker engine is not running (Docker Desktop needs WSL 2 / Virtual Machine Platform).'
    exit 2
}

# ---------------------------------------------------------------- 1. env + stack
$secret = { param($n) & $python -c "import secrets; print(secrets.token_urlsafe($n))" }
$dbPass = & $secret 24
$adminPass = 'Owner-' + (& $secret 12)
$envFile = '.env.local-test'
@"
# LOCAL TEST ONLY (scripts/prod_local_test.ps1) — regenerated on every run.
DOMAIN=localhost
ALLOWED_HOSTS=localhost,127.0.0.1
CORS_ALLOWED_ORIGINS=http://localhost:8080
CSRF_TRUSTED_ORIGINS=http://localhost:8080
SECRET_KEY=$(& $secret 64)
DB_PASSWORD=$dbPass
MYSQL_ROOT_PASSWORD=$(& $secret 24)
GUNICORN_WORKERS=3
"@ | Set-Content -Encoding ascii $envFile

$compose = @('compose', '-p', 'kabulcargo-localtest', '--env-file', $envFile, '-f', 'docker-compose.yml', '-f', 'docker-compose.local.yml')
Write-Host '1) build + start the stack (fresh volumes)'
docker @compose down -v --remove-orphans *> $null
docker @compose up -d --build --wait *> (Join-Path $out 'compose-up.log')
Record 'stack up (all healthchecks green)' ($LASTEXITCODE -eq 0) 'compose-up.log'
docker @compose ps > (Join-Path $out 'compose-ps.txt')
if ($LASTEXITCODE -ne 0 -or -not ((Get-Content (Join-Path $out 'compose-ps.txt')) -match 'nginx')) {
    docker @compose logs --no-color > (Join-Path $out 'compose-logs.txt')
    Write-Error 'stack did not start — see checks-output\prod-local\compose-logs.txt'
    exit 1
}

# ---------------------------------------------------------------- 2. MySQL / Django facts
$tz = docker @compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "SELECT CONVERT_TZ(''2026-01-01 00:00'',''UTC'',''Asia/Kabul''), @@character_set_server" 2>/dev/null'
Record 'MySQL: Kabul time-zone tables + utf8mb4' ("$tz" -match '2026-01-01 04:30:00\s+utf8mb4') "$tz"

$facts = docker @compose exec -T backend python -c "import django,os,glob; django.setup(); from django.conf import settings as s; w=sum('gunicorn' in open(p,'rb').read().decode(errors='ignore') for p in glob.glob('/proc/[0-9]*/cmdline')); print(s.DEBUG, s.CACHES['default']['BACKEND'].rsplit('.',1)[-1], w, os.getuid())"
$f = "$facts".Trim().Split(' ')
Record 'Django: DEBUG off, Redis cache, gunicorn master + 3 workers, non-root' ($f[0] -eq 'False' -and $f[1] -eq 'RedisCache' -and [int]$f[2] -ge 3 -and $f[3] -ne '0') "DEBUG=$($f[0]) cache=$($f[1]) gunicorn processes=$($f[2]) uid=$($f[3])"

# ---------------------------------------------------------------- 3. first run
docker @compose exec -T -e DJANGO_SUPERUSER_PASSWORD=$adminPass backend python manage.py createsuperuser --noinput --username owner --email owner@example.com *> (Join-Path $out 'first-admin.log')
Record 'first super admin (createsuperuser)' ($LASTEXITCODE -eq 0) 'owner'
docker @compose exec -T backend python manage.py seed_statement_lines *> (Join-Path $out 'seed.log')
Record 'seed_statement_lines' ($LASTEXITCODE -eq 0) (Get-Content (Join-Path $out 'seed.log') -Tail 1)

# ---------------------------------------------------------------- 4. production checks
$env:KC_BASE_URL = 'http://localhost:8080'; $env:KC_ADMIN_USER = 'owner'; $env:KC_ADMIN_PASS = $adminPass
Push-Location frontend
node scripts/verify-prod.mjs (Join-Path $out 'verify-prod') *> (Join-Path $out 'verify-prod.log')
$code = $LASTEXITCODE
Pop-Location
Remove-Item Env:KC_BASE_URL, Env:KC_ADMIN_USER, Env:KC_ADMIN_PASS
Record 'verify-prod.mjs' ($code -eq 0) ((Get-Content (Join-Path $out 'verify-prod.log') | Select-String 'passed$' | Select-Object -Last 1))
$keys = docker @compose exec -T redis redis-cli --scan --pattern '*throttle*'
Record 'throttle counters live in Redis' (@($keys).Count -gt 0) "$(@($keys).Count) throttle keys"

# ---------------------------------------------------------------- 5. all E2E suites against the stack
$env:DB_HOST = '127.0.0.1'; $env:DB_PORT = '3307'; $env:DB_NAME = 'kabulcargo'; $env:DB_USER = 'kabulcargo'; $env:DB_PASSWORD = $dbPass
& $python scripts\run_all_checks.py --base-url http://localhost:8080 *> (Join-Path $out 'e2e.log')
$code = $LASTEXITCODE
Remove-Item Env:DB_HOST, Env:DB_PORT, Env:DB_NAME, Env:DB_USER, Env:DB_PASSWORD
Copy-Item checks-output\summary.md (Join-Path $out 'e2e-summary.md') -ErrorAction SilentlyContinue
Record 'all E2E suites against the stack' ($code -eq 0) ((Get-Content (Join-Path $out 'e2e.log') | Select-String '\*\*total\*\*'))

# ---------------------------------------------------------------- 6. backup + restore drill
docker @compose exec -T backup python manage.py backup_db *> (Join-Path $out 'backup.log')
Record 'backup_db in the backup container' ($LASTEXITCODE -eq 0) (Get-Content (Join-Path $out 'backup.log') -Tail 1)
docker @compose exec -T backend python manage.py restore_db --drill *> (Join-Path $out 'restore-drill.log')
Record 'restore drill (restore_db --drill)' ($LASTEXITCODE -eq 0) (Get-Content (Join-Path $out 'restore-drill.log') -Tail 1)

docker @compose logs --no-color > (Join-Path $out 'compose-logs.txt')
if (-not $Keep) {
    docker @compose down -v --remove-orphans *> $null
    Remove-Item $envFile
    Write-Host 'stack and its volumes removed'
} else {
    Write-Host "stack kept: http://localhost:8080  (owner / $adminPass)"
}

$table = @('| step | result | info |', '| --- | --- | --- |') + ($results | ForEach-Object { "| $($_.Step) | $($_.Result) | $($_.Info -replace '\|', '/') |" })
$table | Set-Content -Encoding utf8 (Join-Path $out 'summary.md')
$table | Write-Host
if ($results | Where-Object Result -eq 'FAIL') { exit 1 }
exit 0
