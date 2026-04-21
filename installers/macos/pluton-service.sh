#!/bin/bash
# Pluton macOS Service Wrapper
# Loads credentials from env files before starting the Pluton daemon.
#
# macOS plists do not support EnvironmentFile like systemd. This wrapper reads
# /etc/pluton/pluton.env and /etc/pluton/pluton.enc.env so that installer-provided
# admin credentials and the encryption key are available to the daemon.

set -e

# Ensure HOME points to root's actual home directory.
export HOME=/var/root

# ── Load environment from credentials files ──────────────────────────────────

ENV_FILE="/etc/pluton/pluton.env"
ENC_ENV_FILE="/etc/pluton/pluton.enc.env"

if [ -f "${ENV_FILE}" ]; then
    while IFS='=' read -r key value; do
        case "$key" in '#'*|'') continue;; esac
        key=$(echo "$key" | xargs)
        case "$key" in
            PLUTON_USER_NAME) export PLUTON_USER_NAME="$value" ;;
            PLUTON_USER_PASSWORD) export PLUTON_USER_PASSWORD="$value" ;;
        esac
    done < "${ENV_FILE}"
fi

if [ -f "${ENC_ENV_FILE}" ]; then
    while IFS='=' read -r key value; do
        case "$key" in '#'*|'') continue;; esac
        key=$(echo "$key" | xargs)
        [ "$key" = "PLUTON_ENCRYPTION_KEY" ] && export PLUTON_ENCRYPTION_KEY="$value"
    done < "${ENC_ENV_FILE}"
fi

# ── Execute the Pluton binary (replaces this process) ────────────────────────

exec /opt/pluton/pluton
