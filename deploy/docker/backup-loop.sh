#!/bin/sh
# The "backup" service: python manage.py backup_db every day at BACKUP_HOUR (Kabul time, default 2),
# keeping BACKUP_KEEP_DAYS days (backup_db's default: 30). Copying the files off the server is a
# separate host job: deploy/offsite-backup.sh (see docs/DEPLOY.md).
set -u
hour="${BACKUP_HOUR:-2}"
keep="${BACKUP_KEEP_DAYS:-30}"
echo "backup service: daily at ${hour}:00 $(date +%Z), keeping ${keep} days"
while true; do
  now=$(date +%s)
  next=$(date -d "today ${hour}:00" +%s)
  [ "$next" -le "$now" ] && next=$(date -d "tomorrow ${hour}:00" +%s)
  sleep $((next - now))
  python manage.py backup_db --keep-days "$keep" || echo "$(date -Is) BACKUP FAILED" >&2
done
