#!/bin/sh
# Backend container start: checks, static files for nginx, migrations, then the command (gunicorn).
set -eu

if [ -z "${REDIS_URL:-}" ]; then
  echo "REDIS_URL is required: throttle and rate-limit counters must be shared by all gunicorn workers." >&2
  exit 1
fi

# nginx serves /static/ from the shared volume. Replace its content on every start, so an update
# never serves the previous version's files.
if [ -d /srv/static ]; then
  find /srv/static -mindepth 1 -delete
  cp -a /app/staticfiles/. /srv/static/
fi

python manage.py migrate --noinput
python manage.py check --deploy --fail-level ERROR

exec "$@"
