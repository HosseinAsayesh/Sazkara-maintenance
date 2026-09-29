# Shared by the other tools: loads the server settings and derives a psql-safe URL.
# Not meant to be run on its own.

set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-/etc/sazkara/sazkara.env}"

if [ ! -r "$ENV_FILE" ]; then
  echo "Cannot read $ENV_FILE - run this with sudo, or set ENV_FILE." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set in $ENV_FILE" >&2
  exit 1
fi

# The app's URL carries Prisma options (?schema=public) that psql/pg_dump reject.
DB_URL="${DATABASE_URL%%\?*}"
UPLOADS_DIR="${UPLOADS_DIR:-/var/lib/sazkara/uploads}"
