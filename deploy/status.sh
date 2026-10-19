#!/usr/bin/env sh
# Sanitized status using precisely the same approved configuration and probe.
set -eu
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
DEPLOY_DIR=$SCRIPT_DIR
ENV_FILE="$DEPLOY_DIR/.env"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"
[ "$#" -eq 0 ] || die "Usage: sh status.sh"
require_docker
ensure_application_configuration
begin_deployment
ref=$(read_env_value PLUTON_IMAGE_REF)
version=${ref#*@}
validate_version "$version"
[ "$ref" = "$repository@$version" ] || die "Configured immutable image is invalid."
validate_compose "$ref"
docker image inspect "$ref" > "$WORK_DIR/image.json" 2> "$WORK_DIR/docker-error" || die "Configured image is unavailable."
image=$(policy image "$WORK_DIR/image.json" "$ref") || die "Configured image is invalid."
attempts=1
if ! wait_for_healthy; then die "Application is not healthy ($HEALTH_FAILURE)."; fi
verify_container "$image" || die "Application image, runtime user or mounts do not match."
info "Application healthy; approved image, UID/GID and complete mount contract verified."
