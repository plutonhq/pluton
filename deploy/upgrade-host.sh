#!/usr/bin/env sh
# Run ONLY from an operator-reviewed checkout/bundle, never from a downloaded pipe.
set -eu
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
command -v python3 >/dev/null 2>&1 || { printf '%s\n' 'ERROR: Python 3.8+ is required.' >&2; exit 1; }
exec python3 "$SCRIPT_DIR/bundle-tools.py" "$@"
