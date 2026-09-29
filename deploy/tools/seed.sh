#!/usr/bin/env bash
# First-time setup data: the part catalogue, starting cities, wage placeholders, the
# default project and the first manager (and optional JTI supervisor) account, taken
# from the SEED_* lines in the settings file. Meant for a new installation. Re-running
# it leaves wage rates, settings, records and passwords alone, but resets the part
# catalogue to the standard 30 parts (re-activating any the manager switched off).
#
#   sudo /opt/sazkara/tools/seed.sh

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

if [ -z "${SEED_MANAGER_PASSWORD:-}" ] || [ "$SEED_MANAGER_PASSWORD" = "CHANGE_ME" ]; then
  echo "Set SEED_MANAGER_PASSWORD in $ENV_FILE first." >&2
  exit 1
fi

# The seed uses the app's own database library, so resolve modules from the app folder.
NODE_PATH="$BASE_DIR/app/node_modules" node "$BASE_DIR/tools/seed.cjs"
