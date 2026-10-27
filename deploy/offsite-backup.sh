#!/bin/sh
# Kabul Cargo — copy backups OFF the server (host cron job; docker-compose and Coolify alike).
#
# The backup service keeps 30 days of database dumps inside the server. A dead disk or a lost
# server takes those with it, so once a day this copies them, and the uploaded documents, to
#   1. OFFSITE_LOCAL_DIR on the host (default /var/backups/kabulcargo), then
#   2. OFFSITE_RCLONE_REMOTE, if set: any rclone remote — Backblaze B2, Google Drive, S3,
#      another server over sftp … (set it up once with `rclone config`).
#
# crontab -e   (03:30, after the 02:00 backup):
#   30 3 * * * OFFSITE_RCLONE_REMOTE=b2:kabulcargo-backups /opt/kabulcargo/deploy/offsite-backup.sh >> /var/log/kabulcargo-offsite.log 2>&1
set -eu
LOCAL="${OFFSITE_LOCAL_DIR:-/var/backups/kabulcargo}"
KEEP_DAYS="${OFFSITE_KEEP_DAYS:-30}"

container() {  # the running container of a compose service (any project name: works on Coolify too)
  id=$(docker ps -q --filter "label=com.docker.compose.service=$1" | head -n 1)
  [ -n "$id" ] || { echo "$(date -Is) no running '$1' container" >&2; exit 1; }
  echo "$id"
}

mkdir -p "$LOCAL/db" "$LOCAL/media"
docker cp "$(container backup):/app/backups/." "$LOCAL/db/"
docker cp "$(container backend):/app/media/." "$LOCAL/media/"
find "$LOCAL/db" -name 'kabulcargo-*.sql.gz' -mtime "+$KEEP_DAYS" -delete
latest=$(ls -1 "$LOCAL/db" | grep -E '^kabulcargo-.*\.sql\.gz$' | tail -n 1)
echo "$(date -Is) local copy ok: latest=$latest, media=$(du -sh "$LOCAL/media" | cut -f1)"

if [ -n "${OFFSITE_RCLONE_REMOTE:-}" ]; then
  rclone copy "$LOCAL/db" "$OFFSITE_RCLONE_REMOTE/db" --max-age 72h
  rclone sync "$LOCAL/media" "$OFFSITE_RCLONE_REMOTE/media"
  echo "$(date -Is) off-server copy ok → $OFFSITE_RCLONE_REMOTE"
else
  echo "$(date -Is) WARNING: OFFSITE_RCLONE_REMOTE not set — backups are still only on this server" >&2
fi
