#!/usr/bin/env sh
# Shared operator-only transaction helpers. Never source .env as executable code.
# Globals such as HEALTH_FAILURE are consumed by the sourcing deployment/status scripts.
# shellcheck disable=SC2034
set -eu

die() { printf '%s\n' "ERROR: $*" >&2; exit 1; }
info() { printf '%s\n' "$*"; }
require_file() { [ -f "$1" ] || die "A required deployment file is missing."; }
require_docker() {
 command -v python3 >/dev/null 2>&1 || die "Python 3.8+ (stdlib only) is required on the deployment host."
 python3 -c 'import sys; sys.exit(sys.version_info < (3,8))' || die "Python 3.8+ is required."
 command -v docker >/dev/null 2>&1 || die "Docker Engine is required."
 docker version >/dev/null 2>&1 || die "Docker Engine is unavailable."
 docker compose version >/dev/null 2>&1 || die "Docker Compose v2 plugin is required."
}
read_key_value() {
 [ -f "$1" ] || return 0
 awk -v key="$2" 'index($0,key "=")==1 {value=substr($0,length(key)+2)} END {print value}' "$1" | tr -d '\r'
}
read_env_value() { read_key_value "$ENV_FILE" "$1"; }
set_value_in_file() {
 value_file=$1 value_key=$2 value_new=$3
 temporary="$value_file.tmp.$$"
 umask 077
 awk -v key="$value_key" -v value="$value_new" '
 index($0,key "=")==1 {print key "=" value; found=1; next}
 {print} END {if(!found) print key "=" value}' "$value_file" > "$temporary"
 chmod 600 "$temporary"
 mv "$temporary" "$value_file"
}
write_image_configuration() {
 set_value_in_file "$ENV_FILE" PLUTON_IMAGE_REF "$1"
 set_value_in_file "$ENV_FILE" PLUTON_VERSION "$2"
 set_value_in_file "$WORK_DIR/.env" PLUTON_IMAGE_REF "$1"
 set_value_in_file "$WORK_DIR/.env" PLUTON_VERSION "$2"
}
validate_image_repository() {
 # GHCR for releases; loopback registry is reserved for disposable local acceptance.
 printf '%s' "$1" | grep -Eq '^(ghcr\.io/[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*|127\.0\.0\.1:[0-9]{2,5}/[a-z0-9][a-z0-9._/-]*)$' ||
  die "PLUTON_IMAGE must name a lower-case GHCR repository (or a local loopback test registry)."
}
is_digest() { printf '%s' "$1" | grep -Eq '^sha256:[a-f0-9]{64}$'; }
validate_version() { is_digest "$1" || die "Deploy an approved immutable sha256 digest; tags (including main/latest) are refused."; }
ensure_application_configuration() {
 repository=$(read_env_value PLUTON_IMAGE)
 validate_image_repository "$repository"
 # Do not interpret or regenerate credentials here; application fail-fast validates them.
 key_length=$(printf '%s' "$(read_env_value ENCRYPTION_KEY)" | wc -c | tr -d ' ')
 [ "$key_length" -ge 12 ] || die "Restore the existing ENCRYPTION_KEY (at least 12 characters); deployment never generates or rotates it."
 [ -n "$(read_env_value USER_NAME)" ] || die "USER_NAME is required."
 case "$(read_env_value USER_PASSWORD)" in
  ''|CHANGE_ME*|your-*|example-*) die "Configure USER_PASSWORD locally before deployment." ;;
 esac
}
policy() { python3 "$SCRIPT_DIR/compose-tools.py" "$@"; }
compose() { policy compose "$DEPLOY_DIR" "$WORK_DIR" "$@"; }
cleanup_deployment() {
 # Both paths are created by this process, never derived from .env or user filenames.
 case "${WORK_DIR:-}" in "$DEPLOY_DIR"/.deploy-run.????????) rm -r -- "$WORK_DIR" ;; esac
 if [ "${HAVE_LOCK:-0}" = 1 ]; then rmdir "$DEPLOY_DIR/.deployment-lock"; fi
}
begin_deployment() {
 umask 077
 mkdir "$DEPLOY_DIR/.deployment-lock" 2>/dev/null || die "Another deployment/bundle upgrade holds .deployment-lock; do not remove a live lock."
 HAVE_LOCK=1
 WORK_DIR=$(mktemp -d "$DEPLOY_DIR/.deploy-run.XXXXXXXX")
 trap cleanup_deployment EXIT
 policy snapshot "$DEPLOY_DIR" "$WORK_DIR" || die "Compose overlay approval/ownership check failed."
 attempts=$(read_env_value PLUTON_HEALTH_ATTEMPTS)
 case "$attempts" in '' ) attempts=60 ;; *[!0-9]* ) die "PLUTON_HEALTH_ATTEMPTS must be 1..300." ;; esac
 [ "$attempts" -ge 1 ] && [ "$attempts" -le 300 ] || die "PLUTON_HEALTH_ATTEMPTS must be 1..300."
}
service_container_id() {
 compose ps -q --all pluton > "$WORK_DIR/ps" 2> "$WORK_DIR/docker-error" || return 1
 found=$(cat "$WORK_DIR/ps")
 case "$found" in *[!a-f0-9]* ) return 1 ;; esac
 [ "${#found}" -eq 0 ] || [ "${#found}" -eq 64 ] || return 1
 printf '%s' "$found"
}
validate_compose() {
 compose config --format json > "$WORK_DIR/config.json" 2> "$WORK_DIR/docker-error" || die "Effective Compose is invalid; no service was stopped. Inspect the approved files locally without publishing expanded config."
 policy validate "$WORK_DIR/config.json" "$1" "$SCRIPT_DIR/healthcheck.cjs" "$DEPLOY_DIR" "$WORK_DIR/contract.json" ||
  die "Effective Compose failed deployment policy; no service was stopped."
}
inspect_container() { docker inspect "$1" > "$WORK_DIR/container.json" 2> "$WORK_DIR/docker-error"; }
verify_container() {
 verify_id=$(service_container_id) && [ -n "$verify_id" ] && inspect_container "$verify_id" &&
 policy check-container "$WORK_DIR/config.json" "$WORK_DIR/container.json" "$1" &&
 docker exec "$verify_id" node -e 'if(process.getuid()!==10001 || process.getgid()!==10001)process.exit(1)' >/dev/null 2>&1
}
wait_for_healthy() {
 count=1 HEALTH_FAILURE=container-not-ready
 while [ "$count" -le "$attempts" ]; do
  health_id=$(service_container_id) || health_id=
  if [ -n "$health_id" ] && inspect_container "$health_id"; then
   running=$(policy field "$WORK_DIR/container.json" State.Running)
   docker_health=$(policy field "$WORK_DIR/container.json" State.Health.Status)
   if [ "$running" = true ]; then
    if docker exec -i "$health_id" node < "$SCRIPT_DIR/healthcheck.cjs" >/dev/null 2>&1; then
     if [ "$docker_health" = healthy ]; then return 0; fi
     HEALTH_FAILURE=docker-health-not-ready
    else
     probe_code=$?
     case "$probe_code" in 10) HEALTH_FAILURE=health-connection-or-timeout ;; 11) HEALTH_FAILURE=health-http-status ;; 12) HEALTH_FAILURE=health-invalid-response ;; 13) HEALTH_FAILURE=application-not-ready ;; *) HEALTH_FAILURE=health-probe-execution ;; esac
    fi
   else HEALTH_FAILURE=container-not-running
   fi
  else HEALTH_FAILURE=container-missing
  fi
  [ "$count" -eq "$attempts" ] || sleep 2
  count=$((count + 1))
 done
 return 1
}
backup_sqlite_after_stop() {
 compose stop --timeout 45 pluton > "$WORK_DIR/stop-output" 2>&1 || return 1
 inspect_container "$1" || return 1
 [ "$(policy field "$WORK_DIR/container.json" State.Running)" = false ] || return 1
 policy private-directory "$DEPLOY_DIR/backups" || return 1
 backup_dir=$(mktemp -d "$DEPLOY_DIR/backups/$(date -u +%Y%m%dT%H%M%SZ).XXXXXXXX")
 # Copy stopped DB directory, including WAL/SHM. Never restore it automatically.
 docker cp "$1:/data/db/." "$backup_dir/" > "$WORK_DIR/copy-output" 2>&1 || return 1
 [ -f "$backup_dir/pluton.db" ] || return 1
 find "$backup_dir" -type f -exec chmod 600 {} \;
 info "Consistent stopped SQLite backup retained privately under backups/."
}
write_deploy_state() {
 umask 077
 {
  printf '%s\n' "# Image history only; no application secrets."
  printf '%s\n' "PREVIOUS_IMAGE_REF=$1" "PREVIOUS_VERSION=$2"
  printf '%s\n' "LAST_SUCCESSFUL_IMAGE_REF=$3" "LAST_SUCCESSFUL_VERSION=$4"
 } > "$STATE_FILE.tmp.$$"
 chmod 600 "$STATE_FILE.tmp.$$"
 mv "$STATE_FILE.tmp.$$" "$STATE_FILE"
 policy record "$DEPLOY_DIR" "$WORK_DIR"
}
record_result() {
 printf 'FAILURE_STAGE=%s\nROLLBACK=%s\n' "$1" "$2" > "$DEPLOY_DIR/.deploy-result.tmp.$$"
 chmod 600 "$DEPLOY_DIR/.deploy-result.tmp.$$"
 mv "$DEPLOY_DIR/.deploy-result.tmp.$$" "$DEPLOY_DIR/.deploy-result"
}
