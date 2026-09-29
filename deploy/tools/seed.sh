#!/usr/bin/env bash
# First-time setup data: the six starting cities, wage placeholders, the default
# project and the first manager (and optional JTI supervisor) account, taken from the
# SEED_* lines in the settings file. (The 30-part catalogue is not seeded - it is built
# into the database by migrate.sh.) Safe to re-run: it leaves wage rates, settings,
# records and passwords alone.
#
#   sudo /opt/sazkara/tools/seed.sh

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

if [ -z "${SEED_MANAGER_PASSWORD:-}" ] || [ "$SEED_MANAGER_PASSWORD" = "CHANGE_ME" ]; then
  echo "Set SEED_MANAGER_PASSWORD in $ENV_FILE first." >&2
  exit 1
fi

# The seed uses the app's own database library, so resolve modules from the app folder.
NODE_PATH="$BASE_DIR/app/node_modules" node "$BASE_DIR/tools/seed.cjs"
