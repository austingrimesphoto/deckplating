#!/usr/bin/env bash

set -euo pipefail
set +x

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
START_LOG="$(mktemp)"
STATUS_FILE="$(mktemp)"
SQL_LOG="$(mktemp)"
RESET_LOG="$(mktemp)"
STARTED_AT=$SECONDS

cd "$ROOT_DIR"

sanitize_log() {
  sed -E \
    -e 's#(postgres(ql)?://)[^@[:space:]]+@#\1[REDACTED]@#g' \
    -e 's#eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+#[REDACTED_JWT]#g' \
    -e 's#((ANON_KEY|SERVICE_ROLE_KEY|JWT_SECRET|DB_URL)[=:][[:space:]]*)[^[:space:]]+#\1[REDACTED]#Ig' \
    "$1" | tail -n 30
}

cleanup() {
  set +e
  supabase stop --no-backup >/dev/null 2>&1
  rm -f "$START_LOG" "$STATUS_FILE" "$SQL_LOG" "$RESET_LOG"
}
trap cleanup EXIT INT TERM

for command_name in docker node npm psql supabase; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required local dependency is missing: $command_name" >&2
    exit 1
  fi
done

export DO_NOT_TRACK=1
export SUPABASE_TELEMETRY_DISABLED=1

echo "Starting isolated Supabase services."
if ! supabase start \
  --exclude analytics,edge-runtime,functions,imgproxy,inbucket,meta,realtime,storage,studio,vector \
  >"$START_LOG" 2>&1; then
  echo "Supabase failed to start. Sanitized diagnostics:" >&2
  sanitize_log "$START_LOG" >&2
  exit 1
fi

if ! supabase status -o env >"$STATUS_FILE" 2>/dev/null; then
  echo "Supabase started, but its local connection metadata was unavailable." >&2
  exit 1
fi

# Supabase CLI generated this temporary file for the disposable local stack.
# shellcheck disable=SC1090
source "$STATUS_FILE"

: "${DB_URL:?Supabase status did not return DB_URL}"
: "${API_URL:?Supabase status did not return API_URL}"
: "${ANON_KEY:?Supabase status did not return ANON_KEY}"
: "${SERVICE_ROLE_KEY:?Supabase status did not return SERVICE_ROLE_KEY}"

if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  printf '::add-mask::%s\n' "$DB_URL"
  printf '::add-mask::%s\n' "$ANON_KEY"
  printf '::add-mask::%s\n' "$SERVICE_ROLE_KEY"
  DB_PASSWORD="$(node -e 'process.stdout.write(new URL(process.argv[1]).password)' "$DB_URL")"
  if [[ -n "$DB_PASSWORD" ]]; then printf '::add-mask::%s\n' "$DB_PASSWORD"; fi
  unset DB_PASSWORD
fi

export DECKPLATING_TEST_DATABASE_URL="$DB_URL"
export DECKPLATING_TEST_SUPABASE_URL="$API_URL"
export DECKPLATING_TEST_ANON_KEY="$ANON_KEY"
export DECKPLATING_TEST_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"

echo "Resetting the disposable database from an empty state."
if ! supabase db reset --local --no-seed >"$RESET_LOG" 2>&1; then
  echo "Disposable database reset failed. Sanitized diagnostics:" >&2
  sanitize_log "$RESET_LOG" >&2
  exit 1
fi

echo "Running tracked migration behavior assertions in a rollback-only transaction."
if ! psql "$DECKPLATING_TEST_DATABASE_URL" \
  --no-psqlrc \
  -X \
  -v ON_ERROR_STOP=1 \
  -c 'begin' \
  -f supabase/tests/011_security_reliability_hardening.sql \
  -c 'rollback' \
  >"$SQL_LOG" 2>&1; then
  echo "Tracked migration behavior assertions failed. Sanitized diagnostics:" >&2
  sanitize_log "$SQL_LOG" >&2
  exit 1
fi

echo "Running database concurrency, isolation, idempotency, and PostgREST checks."
npm run test:database:behavior

echo "Database behavior suite passed in $((SECONDS - STARTED_AT)) seconds."
