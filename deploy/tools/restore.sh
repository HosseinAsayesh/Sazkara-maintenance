#!/usr/bin/env bash
# Restores a backup made by backup.sh (or by the developer's laptop): REPLACES the
# current database and uploads with the backup's. The current uploads folder is kept
# aside, not deleted, and the script takes a fresh backup first.
#
#   sudo /opt/sazkara/tools/restore.sh /var/backups/sazkara/20261001-020000

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

src="${1:-}"
if [ -z "$src" ] || [ ! -f "$src/database.sql" ]; then
  echo "Usage: sudo $0 <backup folder containing database.sql and uploads/>" >&2
  exit 1
fi

echo "This will REPLACE the current database and uploads with:"
echo "  $src"
read -r -p "Type YES to continue: " answer
[ "$answer" = "YES" ] || { echo "Cancelled."; exit 1; }

echo "Taking a safety backup of the current state first..."
"$BASE_DIR/tools/backup.sh"

echo "Stopping the app..."
systemctl stop sazkara || true

echo "Restoring the database..."
# The backup is a plain SQL dump, so start from an empty schema.
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$src/database.sql"

if [ -d "$src/uploads" ]; then
  echo "Restoring uploads..."
  if [ -d "$UPLOADS_DIR" ]; then
    aside="$UPLOADS_DIR.before-restore-$(date +%Y%m%d-%H%M%S)"
    mv "$UPLOADS_DIR" "$aside"
    echo "  previous uploads kept at $aside (delete it once you are happy)"
  fi
  cp -a "$src/uploads" "$UPLOADS_DIR"
  chown -R sazkara:sazkara "$UPLOADS_DIR"
fi

echo "Bringing the database structure up to date..."
"$BASE_DIR/tools/migrate.sh"

echo "Starting the app..."
systemctl start sazkara
echo "Restore complete."
