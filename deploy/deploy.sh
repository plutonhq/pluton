#!/usr/bin/env sh
# Deploy one immutable image with a frozen approved Compose stack.
set -eu
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
DEPLOY_DIR=$SCRIPT_DIR
ENV_FILE="$DEPLOY_DIR/.env"
STATE_FILE="$DEPLOY_DIR/.deploy-state"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"
[ "$#" -eq 1 ] || die "Usage: sh deploy.sh sha256:<approved-digest>"
requested_version=$1
validate_version "$requested_version"
require_file "$ENV_FILE"
require_docker
ensure_application_configuration
begin_deployment
target_ref="$repository@$requested_version"
set_value_in_file "$WORK_DIR/.env" PLUTON_IMAGE_REF "$target_ref"
set_value_in_file "$WORK_DIR/.env" PLUTON_VERSION "$requested_version"
validate_compose "$target_ref"
previous_container=$(service_container_id) || die "Cannot identify a unique application container."
previous_ref=
previous_version=
if [ -n "$previous_container" ]; then
 inspect_container "$previous_container" || die "Cannot inspect the existing application container."
 old_image=$(policy field "$WORK_DIR/container.json" Image)
 docker image inspect "$old_image" > "$WORK_DIR/previous-image.json" 2> "$WORK_DIR/docker-error" || die "Cannot inspect the previous image."
 previous_ref=$(policy previous "$WORK_DIR/config.json" "$WORK_DIR/container.json" "$WORK_DIR/previous-image.json" "$repository") ||
  die "Current container/mounts or rollback digest are unsafe; reconcile before deployment."
 previous_version=${previous_ref#*@}
elif [ -f "$STATE_FILE" ] || [ -f "$DEPLOY_DIR/.deploy-contract.json" ]; then
 die "A recorded installation has no application container; investigate rather than create an ambiguous replacement."
fi
info "Pulling the approved immutable application image."
docker pull "$target_ref" > "$WORK_DIR/pull-output" 2>&1 || die "Immutable image pull failed; existing service was not stopped."
docker image inspect "$target_ref" > "$WORK_DIR/target-image.json" 2> "$WORK_DIR/docker-error" || die "Pulled image is unavailable."
target_image=$(policy image "$WORK_DIR/target-image.json" "$target_ref") || die "Pulled image failed identity/runtime checks."
if [ -n "$previous_ref" ] && [ "$previous_ref" = "$target_ref" ] && wait_for_healthy; then
 verify_container "$target_image" || die "Unchanged container failed image/mount validation."
 write_image_configuration "$target_ref" "$requested_version"
 policy record "$DEPLOY_DIR" "$WORK_DIR"
 record_result none not-needed
 info "Already healthy at the approved digest; mounts verified, no recreation needed."
 exit 0
fi

rollback_to_previous() {
 failure=$1
 trap '' HUP INT TERM
 if [ -z "$previous_ref" ]; then
  record_result "$failure" not-available
  die "Deployment failed ($failure); no previous immutable image is available. Data was not reset."
 fi
 info "Deployment failed ($failure). Restoring the previous immutable image with the same overlays."
 write_image_configuration "$previous_ref" "$previous_version"
 if compose up -d --no-deps --force-recreate pluton > "$WORK_DIR/rollback-output" 2>&1 && wait_for_healthy && verify_container "$old_image"; then
  record_result "$failure" healthy
  die "Deployment failed ($failure); rollback verified healthy with unchanged mounts. SQLite backups remain operator-controlled."
 fi
 record_result "$failure" failed
 die "Deployment failed ($failure); rollback could not be verified healthy. Stop and investigate locally; data was not reset."
}
trap 'rollback_to_previous interrupted' HUP INT TERM
if [ -n "$previous_container" ]; then
 if ! backup_sqlite_after_stop "$previous_container"; then rollback_to_previous sqlite-backup-failed; fi
fi
write_image_configuration "$target_ref" "$requested_version"
# Never start overlay dependencies, optional profiles, or remove unrelated services.
if ! compose up -d --no-deps --force-recreate pluton > "$WORK_DIR/up-output" 2>&1; then rollback_to_previous recreate-failed; fi
if ! wait_for_healthy; then rollback_to_previous "$HEALTH_FAILURE"; fi
if ! verify_container "$target_image"; then rollback_to_previous post-start-image-or-mount-mismatch; fi
write_deploy_state "$previous_ref" "$previous_version" "$target_ref" "$requested_version"
record_result none not-needed
info "Deployment verified healthy at the approved digest; all mounts preserved."
