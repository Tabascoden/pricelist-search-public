#!/usr/bin/env bash
set -euo pipefail

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

DB_HOST=${DB_HOST:-127.0.0.1}
DB_PORT=${DB_PORT:-5432}
DB_NAME=${DB_NAME:-smartproc}
DB_USER=${DB_USER:-postgres}
DB_PASSWORD=${DB_PASSWORD:-}

if [ -z "${DB_PASSWORD:-}" ] || [ "$DB_PASSWORD" = "CHANGE_ME" ]; then
  echo "ERROR: DB_PASSWORD is not set (or still CHANGE_ME). Aborting."
  exit 1
fi

export PGPASSWORD="$DB_PASSWORD"

echo "DB: host=$DB_HOST port=$DB_PORT dbname=$DB_NAME user=$DB_USER"

find db/migrations -maxdepth 1 -type f -name "*.sql" | sort | while read -r file; do
  echo "Applying migration: $file"
  psql "host=$DB_HOST port=$DB_PORT dbname=$DB_NAME user=$DB_USER" -v ON_ERROR_STOP=1 -f "$file"
done
