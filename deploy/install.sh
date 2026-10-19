#!/usr/bin/env sh
# Host bundle upgrades are explicit, never a side effect of deploying an image.
set -eu
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"
[ "$#" -ge 1 ] && [ "$#" -le 2 ] || die "Usage: sh install.sh sha256:<approved-digest> [absolute-new-directory]"
requested_version=$1
validate_version "$requested_version"
if [ "$#" -eq 2 ]; then
 TARGET_DIR=$2
elif [ -f "$SCRIPT_DIR/.env" ]; then
 TARGET_DIR=$SCRIPT_DIR
else
 TARGET_DIR=/opt/pluton
fi
case "$TARGET_DIR" in /*) ;; *) die "Installation directory must be absolute." ;; esac
if [ "$SCRIPT_DIR" != "$TARGET_DIR" ]; then
 [ ! -e "$TARGET_DIR" ] || die "Target already exists. Use the reviewed one-time upgrade-host.sh procedure; existing files will not be overwritten."
 umask 077
 mkdir -p "$TARGET_DIR"
 chmod 750 "$TARGET_DIR"
 for file in install.sh deploy.sh rollback.sh status.sh lib.sh compose.yml compose-tools.py healthcheck.cjs upgrade-host.sh bundle-tools.py .env.example; do
  cp "$SCRIPT_DIR/$file" "$TARGET_DIR/$file"
 done
 cp "$TARGET_DIR/.env.example" "$TARGET_DIR/.env"
 chmod 600 "$TARGET_DIR/.env"
 die "New deployment bundle installed. Configure .env locally, including a new ENCRYPTION_KEY, then rerun install.sh from that directory. No credentials were generated."
fi
require_file "$TARGET_DIR/.env"
exec sh "$TARGET_DIR/deploy.sh" "$requested_version"
