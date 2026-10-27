#!/usr/bin/env bash
# Kabul Cargo — test of the production Docker stack on Linux (the same steps as
# scripts/prod_local_test.ps1). Never on the real server: it builds and starts its own throwaway
# stack (project "kabulcargo-stacktest") and removes it with its volumes at the end.
#
#   bash scripts/prod_stack_test.sh            (needs docker, node + frontend/node_modules, python3)
#   GitHub: Actions → "Production stack test" → Run workflow (.github/workflows/stack-test.yml)
#
# Output: checks-output/prod-stack/ (summary.md, logs, memory, image contents, screenshots).
set -u
cd "$(dirname "$0")/.."
ROOT=$(pwd)
OUT="$ROOT/checks-output/prod-stack"
mkdir -p "$OUT"
PY=${PYTHON:-python3}
SUMMARY="$OUT/summary.md"
printf '| step | result | info |\n| --- | --- | --- |\n' > "$SUMMARY"
FAILED=0
record() {  # name ok(0/1) info
  local result=PASS; [ "$2" = 0 ] || { result=FAIL; FAILED=1; }
  printf '  %s  %s  %s\n' "$result" "$1" "$3"
  printf '| %s | %s | %s |\n' "$1" "$result" "$(echo "$3" | tr '|\n' '/ ')" >> "$SUMMARY"
}
rand() { "$PY" -c "import secrets; print(secrets.token_urlsafe($1))"; }

ENV_FILE=.env.stack-test
ADMIN_PASS="Owner-$(rand 12)"
ADMIN_URL="kc-panel-$(rand 6 | tr -dc 'a-zA-Z0-9')/"
DB_PASS=$(rand 24)
cat > "$ENV_FILE" <<EOF
APP_DOMAIN=localhost
ADMIN_URL=$ADMIN_URL
SECRET_KEY=$(rand 64)
DB_PASSWORD=$DB_PASS
MYSQL_ROOT_PASSWORD=$(rand 24)
GUNICORN_WORKERS=3
EOF
DC=(docker compose -p kabulcargo-stacktest --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.local.yml)
cleanup() {
  "${DC[@]}" logs --no-color > "$OUT/compose-logs.txt" 2>&1
  [ "${KEEP:-0}" = 1 ] || { "${DC[@]}" down -v --remove-orphans > /dev/null 2>&1; rm -f "$ENV_FILE"; }
}
trap cleanup EXIT

echo '1) build + start (fresh volumes)'
"${DC[@]}" down -v --remove-orphans > /dev/null 2>&1
"${DC[@]}" up -d --build --wait > "$OUT/compose-up.log" 2>&1
record 'stack up, every healthcheck green (web checks nginx → Django → DB + Redis)' $? "$("${DC[@]}" ps --format '{{.Service}}={{.Health}}' | tr '\n' ' ')"
"${DC[@]}" ps > "$OUT/compose-ps.txt"
grep -q kabulcargo_web "$OUT/compose-ps.txt" || { echo 'stack did not start'; exit 1; }
docker ps --format '{{.Ports}}' --filter label=com.docker.compose.project=kabulcargo-stacktest > "$OUT/ports.txt"
# Only the local-test override publishes ports, and only on 127.0.0.1 (none on a server).
PUBLIC=$(grep -oE '[0-9a-f.:\[\]]+:[0-9]+->' "$OUT/ports.txt" | grep -vc '^127\.0\.0\.1:')
[ "$PUBLIC" -eq 0 ]
record 'published ports: only 127.0.0.1 from the local-test override' $? "$(tr '\n' ' ' < "$OUT/ports.txt")"

echo '2) MySQL / Django facts'
TZ_OUT=$("${DC[@]}" exec -T kabulcargo_db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "SELECT CONVERT_TZ(\"2026-01-01 00:00\",\"UTC\",\"Asia/Kabul\"), @@character_set_server" 2>/dev/null')
echo "$TZ_OUT" | grep -qE '2026-01-01 04:30:00\s+utf8mb4'; record 'MySQL: Kabul time-zone tables + utf8mb4' $? "$TZ_OUT"
FACTS=$("${DC[@]}" exec -T kabulcargo_backend python -c "import django,os,glob; django.setup(); from django.conf import settings as s; w=sum('gunicorn' in open(p,'rb').read().decode(errors='ignore') for p in glob.glob('/proc/[0-9]*/cmdline')); print(s.DEBUG, s.CACHES['default']['BACKEND'].rsplit('.',1)[-1], w, os.getuid())")
read -r DEBUG CACHE WORKERS UID_ <<< "$FACTS"
[ "$DEBUG" = False ] && [ "$CACHE" = RedisCache ] && [ "$WORKERS" -ge 3 ] && [ "$UID_" != 0 ]
record 'Django: DEBUG off, Redis cache, gunicorn master + workers, non-root' $? "$FACTS"

echo '3) first run + image contents + idle memory'
"${DC[@]}" exec -T -e DJANGO_SUPERUSER_PASSWORD="$ADMIN_PASS" kabulcargo_backend python manage.py createsuperuser --noinput --username owner --email owner@example.com > "$OUT/first-admin.log" 2>&1
record 'first super admin (createsuperuser)' $? owner
"${DC[@]}" exec -T kabulcargo_backend sh -c 'python manage.py seed_statement_lines && python manage.py seed_document_types' > "$OUT/seed.log" 2>&1
record 'seed_statement_lines + seed_document_types' $? "$(tail -n 1 "$OUT/seed.log")"
"${DC[@]}" exec -T kabulcargo_backend sh -c 'ls -A /app; echo ---; find /app /srv \( -name ".env" -o -name ".git" -o -name node_modules -o -name "verify_*.py" -o -name "*.md" -o -name "*_screenshots" -o -name frontend -o -name docs \) 2>/dev/null' > "$OUT/backend-image-files.txt"
! sed '1,/^---$/d' "$OUT/backend-image-files.txt" | grep -q .
record 'backend image: runtime code only (no tests, docs, .env, .git, frontend)' $? "$(head -n 30 "$OUT/backend-image-files.txt" | tr '\n' ' ')"
"${DC[@]}" exec -T kabulcargo_web sh -c 'find /usr/share/nginx/html -type f; echo ---; find / -xdev \( -name "*.map" -o -name package.json -o -name node_modules -o -name ".env*" \) 2>/dev/null' > "$OUT/web-image-files.txt"
! sed '1,/^---$/d' "$OUT/web-image-files.txt" | grep -q .
record 'web image: built dist only (no sources, source maps, node_modules)' $? "$(sed '/^---$/,$d' "$OUT/web-image-files.txt" | wc -l) files"
docker image ls --format '{{.Repository}}:{{.Tag}} {{.Size}}' | grep kabulcargo > "$OUT/image-sizes.txt"
record 'image sizes' 0 "$(tr '\n' ' ' < "$OUT/image-sizes.txt")"
sleep 20
docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' | grep kabulcargo > "$OUT/memory-idle.txt"
record 'memory at idle' 0 "$(tr '\n' ',' < "$OUT/memory-idle.txt")"

echo '4) production checks through nginx (verify-prod.mjs)'
( cd frontend && KC_BASE_URL=http://localhost:8080 KC_ADMIN_USER=owner KC_ADMIN_PASS="$ADMIN_PASS" KC_ADMIN_URL="$ADMIN_URL" \
  node scripts/verify-prod.mjs "$OUT/verify-prod" > "$OUT/verify-prod.log" 2>&1 )
record 'verify-prod.mjs (UI first run, headers, /media closed, X-Accel download, health, throttle)' $? "$(grep 'passed$' "$OUT/verify-prod.log" | tail -n 1)"
KEYS=$("${DC[@]}" exec -T kabulcargo_redis redis-cli --scan --pattern '*throttle*' | wc -l)
[ "$KEYS" -gt 0 ]; record 'throttle counters live in Redis (shared by the workers)' $? "$KEYS keys"

echo '5) Kabul day at 23:50 / 00:10'
"${DC[@]}" exec -T -w /app kabulcargo_backend python - < scripts/verify_kabul_day.py > "$OUT/kabul-day.log" 2>&1
record 'transaction at 23:50 / 00:10 Kabul → right Shamsi day' $? "$(tail -n 1 "$OUT/kabul-day.log")"

echo '6) 20 users × 2 minutes, memory sampled'
KC_ADMIN_USER=owner KC_ADMIN_PASS="$ADMIN_PASS" "$PY" scripts/load_test.py --base-url http://localhost:8080 --users 20 --seconds 120 > "$OUT/load.json" 2>&1 &
LOAD=$!
: > "$OUT/memory-samples.txt"
while kill -0 "$LOAD" 2>/dev/null; do
  docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' | grep kabulcargo >> "$OUT/memory-samples.txt"
  sleep 5
done
wait "$LOAD"; LOAD_RC=$?
record '20 users × 2 minutes: every request 200' "$LOAD_RC" "$(cat "$OUT/load.json")"
"$PY" - "$OUT/memory-samples.txt" > "$OUT/memory-peak.txt" <<'EOF'
import re, sys
peak = {}
for line in open(sys.argv[1]):
    name, used = line.split()[0], line.split()[1]
    value, unit = re.match(r'([\d.]+)(\w+)', used).groups()
    mib = float(value) * {'B': 1 / 2**20, 'KiB': 1 / 1024, 'MiB': 1, 'GiB': 1024}[unit]
    peak[name] = max(peak.get(name, 0), mib)
print(', '.join(f'{name} {mib:.0f} MiB' for name, mib in sorted(peak.items())))
EOF
record 'memory peak under load' 0 "$(cat "$OUT/memory-peak.txt")"

echo '7) backup + restore drill'
"${DC[@]}" exec -T kabulcargo_backend python manage.py backup_db > "$OUT/backup.log" 2>&1
record 'backup_db (the Coolify Scheduled Task command)' $? "$(tail -n 1 "$OUT/backup.log")"
"${DC[@]}" exec -T kabulcargo_backend python manage.py restore_db --drill > "$OUT/restore-drill.log" 2>&1
record 'restore drill: identical row counts in every table' $? "$(tail -n 1 "$OUT/restore-drill.log")"

echo
cat "$SUMMARY"
exit $FAILED
