#!/usr/bin/env bash
#
# pg-migrate.sh — copy a Postgres database from OLD_URL to NEW_URL.
#
# Built for the 2026-05-27 Stockholm → London Cloud SQL migration but kept
# generic so the same script can be reused for future migrations or as a
# manual on-demand backup. Idempotent: --clean --if-exists means the script
# can be re-run safely; data on the destination is wiped and rewritten from
# a fresh source dump.
#
# Usage:
#   1. Edit OLD_URL and NEW_URL at the top of this file (or `export` them
#      in your shell before running).
#   2. ./pg-migrate.sh check     — verify connectivity (read-only, no data moves)
#   3. ./pg-migrate.sh backup    — dump OLD_URL to a timestamped file (no NEW writes)
#   4. ./pg-migrate.sh migrate   — drop NEW data + reload from OLD
#   5. ./pg-migrate.sh verify    — compare row counts on key tables
#   6. ./pg-migrate.sh all       — check + migrate + verify (the full flow)
#
# Requires PostgreSQL client tools v18+. On Debian/Ubuntu:
#   sudo apt-get install -y postgresql-client-18
# On macOS:
#   brew install postgresql@18
#
# Passwords are never echoed — output uses *** masking on URLs.

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# CONFIGURATION — fill these in (or `export` them in your shell)
# ──────────────────────────────────────────────────────────────────────────────

# Source — read-only during the migration; pg_dump never writes to it.
# This is the database you're migrating FROM.
: "${OLD_URL:=postgres://USER:PASSWORD@OLD_HOST:5432/yannis?sslmode=require}"

# Destination — wiped and reloaded on every `migrate` run.
# This is the database you're migrating TO.
: "${NEW_URL:=postgres://yannis_app:PASSWORD@NEW_HOST:5432/yannis?sslmode=require}"

# Tables to spot-check in `verify` mode. Add tables here as the schema grows.
# Tables not present in OLD or NEW are reported as SKIP, not FAIL.
VERIFY_TABLES=(
  orders
  order_items
  users
  products
  call_logs
  outbound_messages
  campaigns
  cs_workloads
  payout_records
  branches
  logistics_locations
  logistics_providers
  ad_spend_logs
)

# Where backup files land. Override with BACKUP_DIR=... if you want elsewhere.
: "${BACKUP_DIR:=/tmp}"

# ──────────────────────────────────────────────────────────────────────────────
# IMPLEMENTATION — generally don't edit below
# ──────────────────────────────────────────────────────────────────────────────

log() { echo "[$(date +'%H:%M:%S')] $*" >&2; }
die() { log "ERROR: $*"; exit 1; }

# Masks the user:password portion of a URL for safe logging.
mask() { echo "$1" | sed -E 's|://[^@]*@|://***@|'; }

# Extracts just host:port from a URL (no scheme, no path, no creds).
host_of() { echo "$1" | sed -E 's|^[a-z]+://[^@]*@||;s|/.*||'; }

require_tool() {
  command -v "$1" >/dev/null 2>&1 \
    || die "$1 is not installed. Install postgresql-client-18 first."
}

require_url_set() {
  local label=$1 url=$2
  case "$url" in
    *USER:PASSWORD*|*OLD_HOST*|*NEW_HOST*)
      die "$label still has placeholder values. Edit the top of this script or export $label."
      ;;
  esac
}

check_url() {
  local label=$1 url=$2
  log "Checking $label @ $(host_of "$url")"
  PGCONNECT_TIMEOUT=10 psql "$url" -tA -c "SELECT 1;" >/dev/null \
    || die "Cannot connect to $label. Check authorized_networks / credentials."
}

cmd_check() {
  require_tool pg_dump
  require_tool pg_restore
  require_tool psql

  require_url_set OLD_URL "$OLD_URL"
  require_url_set NEW_URL "$NEW_URL"

  check_url OLD "$OLD_URL"
  check_url NEW "$NEW_URL"

  local old_ver new_ver client_ver
  old_ver=$(psql "$OLD_URL" -tA -c "SHOW server_version_num;")
  new_ver=$(psql "$NEW_URL" -tA -c "SHOW server_version_num;")
  client_ver=$(pg_dump --version | grep -oE '[0-9]+' | head -1)

  log "OLD server: ${old_ver:0:2}.x  |  NEW server: ${new_ver:0:2}.x  |  pg_dump client: $client_ver.x"

  if [ "$client_ver" -lt "${old_ver:0:2}" ]; then
    die "pg_dump v$client_ver cannot reliably dump from PG${old_ver:0:2}. Upgrade postgresql-client."
  fi
  log "Both URLs reachable. Versions compatible."
}

cmd_backup() {
  require_tool pg_dump
  require_url_set OLD_URL "$OLD_URL"
  check_url OLD "$OLD_URL"

  mkdir -p "$BACKUP_DIR"
  local ts file
  ts=$(date -u +'%Y%m%d-%H%M%SZ')
  file="$BACKUP_DIR/pg-backup-$(host_of "$OLD_URL" | tr ':.' '--')-$ts.dump"

  log "Dumping $(mask "$OLD_URL") → $file"
  pg_dump --format=custom --no-owner --no-privileges "$OLD_URL" --file="$file"

  local size
  size=$(du -h "$file" | awk '{print $1}')
  log "Backup complete: $file ($size)"
  echo "$file"   # to stdout so it's pipe-able into other commands
}

cmd_migrate() {
  cmd_check

  log "Running pg_dump | pg_restore (--clean --if-exists)…"
  log "  source: $(host_of "$OLD_URL")"
  log "  target: $(host_of "$NEW_URL")"

  local logfile=/tmp/pg-migrate-$(date -u +'%Y%m%d-%H%M%SZ').log
  pg_dump --format=custom --no-owner --no-privileges "$OLD_URL" \
    | pg_restore --no-owner --no-privileges --clean --if-exists \
                 --dbname="$NEW_URL" --verbose 2>"$logfile" \
    || die "Migration failed. Full log: $logfile"

  # pg_restore emits warnings as 'ERROR' lines even for harmless cases (e.g. role
  # not found because --no-owner is set). Surface only the real errors:
  local real_errors
  real_errors=$(grep -cE '^pg_restore: error:' "$logfile" || true)
  if [ "$real_errors" -gt 0 ]; then
    log "WARNING: $real_errors pg_restore errors. Inspect $logfile before trusting the new DB."
  else
    log "Restore clean (0 errors). Full log: $logfile"
  fi
}

cmd_verify() {
  require_url_set OLD_URL "$OLD_URL"
  require_url_set NEW_URL "$NEW_URL"
  check_url OLD "$OLD_URL"
  check_url NEW "$NEW_URL"

  log "Comparing row counts on ${#VERIFY_TABLES[@]} tables…"
  local failed=0 skipped=0 ok=0
  for tbl in "${VERIFY_TABLES[@]}"; do
    local old_count new_count
    old_count=$(psql "$OLD_URL" -tA -c "SELECT COUNT(*) FROM \"$tbl\";" 2>/dev/null || echo "—")
    new_count=$(psql "$NEW_URL" -tA -c "SELECT COUNT(*) FROM \"$tbl\";" 2>/dev/null || echo "—")
    if [ "$old_count" = "—" ] || [ "$new_count" = "—" ]; then
      printf '  %-30s  SKIP  (not present in OLD or NEW)\n' "$tbl"
      skipped=$((skipped+1))
    elif [ "$old_count" = "$new_count" ]; then
      printf '  %-30s  OK    %s\n' "$tbl" "$old_count"
      ok=$((ok+1))
    else
      printf '  %-30s  FAIL  OLD=%s NEW=%s\n' "$tbl" "$old_count" "$new_count"
      failed=$((failed+1))
    fi
  done

  log "Summary: $ok ok, $skipped skipped, $failed failed."
  [ "$failed" -eq 0 ] \
    || die "$failed tables mismatched — investigate before swapping DATABASE_URL."
}

usage() {
  cat <<EOF
Usage: $0 {check|backup|migrate|verify|all|help}

  check    — verify tools, connectivity, version compatibility (no writes)
  backup   — dump OLD_URL to a .dump file in \$BACKUP_DIR (no NEW_URL writes)
  migrate  — drop existing data on NEW + reload from OLD (idempotent)
  verify   — compare row counts between OLD and NEW on key tables
  all      — check, then migrate, then verify
  help     — this message

Set OLD_URL and NEW_URL at the top of this file, or export them:

  export OLD_URL='postgres://user:pwd@old-host:5432/yannis?sslmode=require'
  export NEW_URL='postgres://user:pwd@new-host:5432/yannis?sslmode=require'
  $0 all

Files produced:
  \$BACKUP_DIR/pg-backup-<host>-<timestamp>.dump   (from \`backup\`)
  /tmp/pg-migrate-<timestamp>.log                  (from \`migrate\`)
EOF
}

case "${1:-help}" in
  check)   cmd_check ;;
  backup)  cmd_backup ;;
  migrate) cmd_migrate ;;
  verify)  cmd_verify ;;
  all)     cmd_check && cmd_migrate && cmd_verify ;;
  help|-h|--help) usage ;;
  *) usage; exit 1 ;;
esac
