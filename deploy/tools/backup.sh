#!/usr/bin/env bash
# Backs up everything the app owns: the database and the uploads folder (photos,
# signatures, imports, PDFs). Neither half is enough alone — reports point at files.
#
#   sudo /opt/sazkara/tools/backup.sh
#
# Writes BACKUP_DIR/<date-time>/{database.sql,uploads/} and removes backups older than
# KEEP_DAYS. Copy BACKUP_DIR off this server regularly — a backup on the same disk
# does not survive that disk.

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/sazkara}"
KEEP_DAYS="${KEEP_DAYS:-14}"

stamp="$(date +%Y%m%d-%H%M%S)"
out="$BACKUP_DIR/$stamp"
mkdir -p "$out"
chmod 700 "$BACKUP_DIR"

# Same format as the developer's laptop backups, so restore.sh takes either.
pg_dump --no-owner --no-privileges --file "$out/database.sql" "$DB_URL"

if [ -d "$UPLOADS_DIR" ]; then
  cp -a "$UPLOADS_DIR" "$out/uploads"
else
  mkdir -p "$out/uploads"
  echo "Note: $UPLOADS_DIR does not exist yet - backed up an empty uploads folder."
fi

# Only prune once today's backup is safely written.
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime +"$KEEP_DAYS" -exec rm -rf {} +

size=$(du -sh "$out" | cut -f1)
echo "Backup complete: $out ($size)"
