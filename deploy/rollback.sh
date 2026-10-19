#!/usr/bin/env sh
# Image-only rollback. Never restore an older SQLite file or remove lease state.
set -eu
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"
[ "$#" -eq 0 ] || die "Usage: sh rollback.sh"
ENV_FILE="$SCRIPT_DIR/.env"
require_file "$SCRIPT_DIR/.deploy-state"
previous_ref=$(read_key_value "$SCRIPT_DIR/.deploy-state" PREVIOUS_IMAGE_REF)
previous_version=$(read_key_value "$SCRIPT_DIR/.deploy-state" PREVIOUS_VERSION)
repository=$(read_env_value PLUTON_IMAGE)
validate_image_repository "$repository"
validate_version "$previous_version"
[ "$previous_ref" = "$repository@$previous_version" ] || die "Recorded rollback image is invalid."
info "Rolling back the application image only; SQLite migrations and durable leases are retained."
exec sh "$SCRIPT_DIR/deploy.sh" "$previous_version"
