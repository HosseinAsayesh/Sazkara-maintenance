#!/usr/bin/env bash
# Creates or updates the database tables. Safe to run any number of times: each
# migration is applied once, in order, inside its own transaction, and recorded in the
# same "_prisma_migrations" table Prisma itself uses.
#
#   sudo /opt/sazkara/tools/migrate.sh

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

MIGRATIONS_DIR="$BASE_DIR/database/migrations"

psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id"                  VARCHAR(36) PRIMARY KEY NOT NULL,
  "checksum"            VARCHAR(64) NOT NULL,
  "finished_at"         TIMESTAMPTZ,
  "migration_name"      VARCHAR(255) NOT NULL,
  "logs"                TEXT,
  "rolled_back_at"      TIMESTAMPTZ,
  "started_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
);
SQL

applied_count=0
for dir in $(ls -1 "$MIGRATIONS_DIR" | sort); do
  file="$MIGRATIONS_DIR/$dir/migration.sql"
  [ -f "$file" ] || continue

  done_already=$(psql "$DB_URL" -tAc \
    "SELECT 1 FROM \"_prisma_migrations\" WHERE migration_name = '$dir' AND finished_at IS NOT NULL AND rolled_back_at IS NULL LIMIT 1")
  [ "$done_already" = "1" ] && continue

  echo "Applying $dir"
  checksum=$(sha256sum "$file" | cut -d' ' -f1)
  # -1 wraps the migration and its bookkeeping row in one transaction: either both land
  # or neither does.
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -1 \
    -f "$file" \
    -c "INSERT INTO \"_prisma_migrations\" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES (gen_random_uuid()::text, '$checksum', now(), '$dir', 1)"
  applied_count=$((applied_count + 1))
done

if [ "$applied_count" -eq 0 ]; then
  echo "Database is already up to date."
else
  echo "Applied $applied_count migration(s)."
fi
