#!/usr/bin/env bash
set -euo pipefail

# shellcheck disable=SC1091
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

DB_HOST=${DB_HOST:-127.0.0.1}
DB_PORT=${DB_PORT:-5432}
DB_NAME=${DB_NAME:-smartproc}
DB_USER=${DB_USER:-postgres}
DB_PASSWORD=${DB_PASSWORD:-}

export PGPASSWORD="$DB_PASSWORD"

for file in $(ls db/migrations/*.sql 2>/dev/null | sort); do
  echo "Applying migration: $file"
  psql "host=$DB_HOST port=$DB_PORT dbname=$DB_NAME user=$DB_USER" -v ON_ERROR_STOP=1 -f "$file"
done
