#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
INSTALLER="$SCRIPT_DIR/../install-agent.sh"
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"
TEST_ROOT="$(mktemp -d "$REPOSITORY_ROOT/.pluton-agent-test.XXXXXX")"

cleanup() {
	case "$(basename -- "$TEST_ROOT")" in
		.pluton-agent-test.*) rm -rf -- "$TEST_ROOT" ;;
		*) printf 'Refusing to remove a non-temporary test root.\n' >&2; exit 1 ;;
	esac
}
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$*" >&2
	exit 1
}

# Load the installer once so its readonly constants are not redeclared when
# the isolated checksum helpers are exercised below.
# shellcheck disable=SC1090
source "$INSTALLER"

assert_file() {
	[[ -f "$1" ]] || fail "Expected file: $1"
}

assert_missing() {
	[[ ! -e "$1" ]] || fail "Expected no path: $1"
}

assert_mode() {
	local expected="$1" pathname="$2" actual
	actual="$(stat -c '%a' -- "$pathname")" || fail "Could not inspect mode: $pathname"
	[[ "$actual" == "$expected" ]] || fail "Expected mode $expected for $pathname, got $actual"
}

assert_private_runtime_access() {
	local root="$1"
	assert_mode 755 "$root/opt/pluton-agent"
	assert_mode 755 "$root/opt/pluton-agent/runtime"
	assert_mode 755 "$root/opt/pluton-agent/runtime/bin"
	assert_mode 755 "$root/opt/pluton-agent/runtime/bin/node"
	assert_mode 755 "$root/opt/pluton-agent/bin"
	assert_mode 755 "$root/opt/pluton-agent/bin/restic"
	assert_mode 755 "$root/opt/pluton-agent/bin/rclone"
	"$root/opt/pluton-agent/runtime/bin/node" -v >/dev/null || fail 'The private Node runtime failed validation.'
	"$root/opt/pluton-agent/bin/restic" version >/dev/null || fail 'The private Restic binary failed validation.'
	"$root/opt/pluton-agent/bin/rclone" version >/dev/null || fail 'The private Rclone binary failed validation.'
}

make_root() {
	local name="$1"
	local root
	root="$(mktemp -d "$TEST_ROOT/.pluton-agent-test.$name.XXXXXX")"
	mkdir -p -- "$root/source"
	printf '%s' "$root"
}

run_installer() {
	local root="$1"
	shift
	PLUTON_AGENT_TEST_MODE=1 PLUTON_AGENT_TEST_ROOT="$root" "$INSTALLER" "$@"
}

base_install() {
	local root="$1"
	run_installer "$root" --server https://pluton.example.internal --allowed-root "$root/source"
}

test_fresh_install_and_generated_files() {
	local root
	root="$(make_root fresh)"
	printf 'host-node-must-not-change' > "$root/system-node"
	local before
	before="$(sha256sum "$root/system-node")"
	base_install "$root"
	[[ "$before" == "$(sha256sum "$root/system-node")" ]] || fail 'The installer changed a simulated host Node runtime.'
	assert_file "$root/opt/pluton-agent/runtime/bin/node"
	assert_file "$root/opt/pluton-agent/bin/restic"
	assert_file "$root/opt/pluton-agent/bin/rclone"
	assert_file "$root/opt/pluton-agent/app/dist/index.js"
	assert_file "$root/var/lib/pluton-agent/identity.json"
	assert_file "$root/etc/pluton-agent.env"
	assert_file "$root/etc/systemd/system/pluton-agent.service"
	grep -Fx 'PLUTON_SERVER_URL="https://pluton.example.internal"' "$root/etc/pluton-agent.env" >/dev/null
	grep -Fx "PLUTON_AGENT_ALLOWED_ROOTS=\"$root/source\"" "$root/etc/pluton-agent.env" >/dev/null
	grep -Fx "PLUTON_AGENT_BIN_DIR=\"$root/opt/pluton-agent/bin\"" "$root/etc/pluton-agent.env" >/dev/null
	grep -Fx 'ALLOW_INSECURE_HTTP="false"' "$root/etc/pluton-agent.env" >/dev/null
	grep -Fx 'User=pluton-agent' "$root/etc/systemd/system/pluton-agent.service" >/dev/null
	grep -Fx "EnvironmentFile=$root/etc/pluton-agent.env" "$root/etc/systemd/system/pluton-agent.service" >/dev/null
	grep -Fx "ExecStart=$root/opt/pluton-agent/runtime/bin/node $root/opt/pluton-agent/app/dist/index.js run" "$root/etc/systemd/system/pluton-agent.service" >/dev/null
	grep -Fx 'NoNewPrivileges=yes' "$root/etc/systemd/system/pluton-agent.service" >/dev/null
	grep -Fx 'PrivateTmp=yes' "$root/etc/systemd/system/pluton-agent.service" >/dev/null
	"$root/opt/pluton-agent/bin/restic" version | grep -F '0.19.1' >/dev/null
	"$root/opt/pluton-agent/bin/rclone" version | grep -F '1.75.1' >/dev/null
}

test_reinstall_preserves_identity_and_private_runtime_access() {
	local root identity before
	root="$(make_root reinstall)"
	base_install "$root"
	identity="$root/var/lib/pluton-agent/identity.json"
	before="$(sha256sum "$identity")"
	assert_private_runtime_access "$root"
	(
		umask 077
		run_installer "$root" --server https://replacement.example.internal --allowed-root "$root/source"
	)
	[[ "$before" == "$(sha256sum "$identity")" ]] || fail 'A normal reinstall replaced the existing identity.'
	grep -Fx 'PLUTON_SERVER_URL="https://replacement.example.internal"' "$root/etc/pluton-agent.env" >/dev/null || fail 'The reinstall did not activate the replacement configuration.'
	assert_private_runtime_access "$root"
}

test_failed_update_restores_previous_installation() {
	local root identity_before config_before
	root="$(make_root failed-update)"
	base_install "$root"
	identity_before="$(sha256sum "$root/var/lib/pluton-agent/identity.json")"
	config_before="$(cat "$root/etc/pluton-agent.env")"
	printf 'previous-installation\n' > "$root/opt/pluton-agent/app/dist/rollback-marker"
	if PLUTON_AGENT_TEST_MODE=1 PLUTON_AGENT_TEST_ROOT="$root" PLUTON_AGENT_TEST_CONTROL_PLANE_FAIL=1 "$INSTALLER" --server https://replacement.example.internal --allowed-root "$root/source" >/dev/null 2>&1; then
		fail 'A simulated control-plane validation failure unexpectedly succeeded.'
	fi
	[[ "$identity_before" == "$(sha256sum "$root/var/lib/pluton-agent/identity.json")" ]] || fail 'A failed update replaced the prior identity.'
	[[ "$config_before" == "$(cat "$root/etc/pluton-agent.env")" ]] || fail 'A failed update did not restore the prior configuration.'
	grep -Fx 'previous-installation' "$root/opt/pluton-agent/app/dist/rollback-marker" >/dev/null || fail 'A failed update did not restore the prior application.'
	assert_private_runtime_access "$root"
}

test_failed_reenrollment_restores_previous_installation() {
	local root identity before config_before
	root="$(make_root reenrollment)"
	base_install "$root"
	identity="$root/var/lib/pluton-agent/identity.json"
	before="$(sha256sum "$identity")"
	config_before="$(cat "$root/etc/pluton-agent.env")"
	printf 'previous-installation\n' > "$root/opt/pluton-agent/app/dist/rollback-marker"
	if PLUTON_AGENT_TEST_MODE=1 PLUTON_AGENT_TEST_ROOT="$root" PLUTON_AGENT_TEST_ENROLL_FAIL=1 "$INSTALLER" --server https://replacement.example.internal --allowed-root "$root/source" --re-enroll --force >/dev/null 2>&1; then
		fail 'A simulated re-enrollment failure unexpectedly succeeded.'
	fi
	[[ "$before" == "$(sha256sum "$identity")" ]] || fail 'A failed re-enrollment did not restore the prior identity.'
	[[ "$config_before" == "$(cat "$root/etc/pluton-agent.env")" ]] || fail 'A failed re-enrollment did not restore the prior configuration.'
	grep -Fx 'previous-installation' "$root/opt/pluton-agent/app/dist/rollback-marker" >/dev/null || fail 'A failed re-enrollment did not restore the prior application.'
	assert_private_runtime_access "$root"
}

test_http_requires_explicit_opt_in() {
	local root
	root="$(make_root http-reject)"
	if run_installer "$root" --server http://192.0.2.10:5173 --allowed-root "$root/source" >/dev/null 2>&1; then
		fail 'HTTP installation succeeded without --allow-insecure-http.'
	fi
	root="$(make_root http-allow)"
	run_installer "$root" --server http://192.0.2.10:5173 --allowed-root "$root/source" --allow-insecure-http
	grep -Fx 'ALLOW_INSECURE_HTTP="true"' "$root/etc/pluton-agent.env" >/dev/null
}

test_quick_enrollment_token_is_accepted_without_persistence() {
	local root quick_token
	root="$(make_root quick-token)"
	quick_token='quick-enrollment-token-for-test'
	run_installer "$root" --server https://pluton.example.internal --allowed-root "$root/source" --token "$quick_token"
	if grep -R --fixed-strings -- "$quick_token" "$root" >/dev/null 2>&1; then
		fail 'A quick-install enrollment token was persisted to disk.'
	fi
}

test_conflicting_enrollment_token_inputs_are_rejected() {
	local root
	root="$(make_root conflicting-token-inputs)"
	if run_installer "$root" --server https://pluton.example.internal --allowed-root "$root/source" --token quick-enrollment-token-for-test --token-stdin >/dev/null 2>&1; then
		fail 'The installer accepted both --token and --token-stdin.'
	fi
}

test_multiple_roots_and_private_ca_configuration() {
	local root ca_file
	root="$(make_root multiple-roots)"
	mkdir -p -- "$root/second-source"
	ca_file="$root/private-ca.pem"
	printf 'test-ca' > "$ca_file"
	run_installer "$root" --server https://pluton.example.internal --allowed-root "$root/source" --allowed-root "$root/second-source" --allowed-root "$root/source" --ca-file "$ca_file"
	grep -Fx "PLUTON_AGENT_ALLOWED_ROOTS=\"$root/source,$root/second-source\"" "$root/etc/pluton-agent.env" >/dev/null
	grep -Fx "PLUTON_AGENT_CA_FILE=\"$ca_file\"" "$root/etc/pluton-agent.env" >/dev/null
	run_installer "$root" --server https://pluton.example.internal --allowed-root "$root/source" --allowed-root "$root/second-source"
	grep -Fx "PLUTON_AGENT_CA_FILE=\"$ca_file\"" "$root/etc/pluton-agent.env" >/dev/null
}

test_platform_rejections() {
	local root
	root="$(make_root unsupported-arch)"
	if PLUTON_AGENT_TEST_MODE=1 PLUTON_AGENT_TEST_ROOT="$root" PLUTON_AGENT_TEST_ARCH=arm64 "$INSTALLER" --server https://pluton.example.internal --allowed-root "$root/source" >/dev/null 2>&1; then
		fail 'Unsupported architecture was accepted.'
	fi
	root="$(make_root missing-systemd)"
	if PLUTON_AGENT_TEST_MODE=1 PLUTON_AGENT_TEST_ROOT="$root" PLUTON_AGENT_TEST_SYSTEMD=missing "$INSTALLER" --server https://pluton.example.internal --allowed-root "$root/source" >/dev/null 2>&1; then
		fail 'Missing systemd was accepted.'
	fi
}

test_checksum_mismatch_is_rejected() {
	local checksum_root archive checksums
	checksum_root="$(make_root checksum)"
	archive="$checksum_root/node.tar.xz"
	checksums="$checksum_root/SHASUMS256.txt"
	printf 'not-the-expected-archive' > "$archive"
	printf '%064d  %s\n' 0 "$(basename -- "$archive")" > "$checksums"
	if verify_node_checksum "$archive" "$checksums"; then
		fail 'A checksum mismatch was accepted.'
	fi
}

test_private_binary_checksum_mismatch_is_rejected() {
	local checksum_root archive
	checksum_root="$(make_root binary-checksum)"
	archive="$checksum_root/restic.bz2"
	printf 'not-the-expected-binary' > "$archive"
	if verify_pinned_checksum "$archive" '0000000000000000000000000000000000000000000000000000000000000000'; then
		fail 'A private binary checksum mismatch was accepted.'
	fi
}

test_uninstall_and_purge() {
	local root identity
	root="$(make_root uninstall)"
	base_install "$root"
	identity="$root/var/lib/pluton-agent/identity.json"
	run_installer "$root" uninstall
	assert_missing "$root/opt/pluton-agent"
	assert_missing "$root/etc/systemd/system/pluton-agent.service"
	assert_file "$identity"
	assert_file "$root/etc/pluton-agent.env"
	if run_installer "$root" uninstall --purge >/dev/null 2>&1; then
		fail 'Purge succeeded without confirmation or --force.'
	fi
	assert_file "$identity"
	run_installer "$root" uninstall --purge --force
	assert_missing "$root/var/lib/pluton-agent"
	assert_missing "$root/etc/pluton-agent.env"
}

test_verified_configuration_only_reinstall_reuses_application() {
	local root output before identity
	root="$(make_root cache)"; base_install "$root"
	before="$(sha256sum "$root/opt/pluton-agent/app/dist/index.js")"; identity="$(sha256sum "$root/var/lib/pluton-agent/identity.json")"
	mkdir -- "$root/second-source"
	output="$(run_installer "$root" --server https://pluton.example.internal --allowed-root "$root/source" --allowed-root "$root/second-source")"
	[[ "$output" == *'Reusing verified application build; configuration-only reinstall.'* ]] || fail 'Verified configuration-only install did not reuse the app.'
	[[ "$before" == "$(sha256sum "$root/opt/pluton-agent/app/dist/index.js")" && "$identity" == "$(sha256sum "$root/var/lib/pluton-agent/identity.json")" ]] || fail 'Reuse changed application or identity.'
	grep -Fx "PLUTON_AGENT_ALLOWED_ROOTS=\"$root/source,$root/second-source\"" "$root/etc/pluton-agent.env" >/dev/null
}

test_cache_rejects_unverified_or_tampered_install() {
	local root mode output
	for mode in absent binary writable symlink unhashed-link version; do
		root="$(make_root "cache-$mode")"; base_install "$root"
		case "$mode" in
			absent) rm -- "$root/opt/pluton-agent/.verified-install" ;;
			binary) printf 'tampered\n' >> "$root/opt/pluton-agent/bin/rclone" ;;
			writable) chmod 0775 -- "$root/opt/pluton-agent/runtime/bin" ;;
			symlink) ln -s /etc/passwd "$root/opt/pluton-agent/app/external" ;;
			unhashed-link) printf 'unverified\n' > "$root/opt/pluton-agent/unverified"; ln -s ../unverified "$root/opt/pluton-agent/app/unhashed" ;;
			version) sed -i 's/node=v22.18.0/node=v99.0.0/' "$root/opt/pluton-agent/.verified-install" ;;
		esac
		output="$(base_install "$root")"
		[[ "$output" == *'No reusable verified installation'* ]] || fail "Unsafe $mode cache was reused."
		assert_private_runtime_access "$root"
	done
}

test_verified_reuse_rollback_preserves_previous_tree() {
	local root before identity config
	root="$(make_root cache-rollback)"; base_install "$root"
	before="$(sha256sum "$root/opt/pluton-agent/.verified-install")"; identity="$(sha256sum "$root/var/lib/pluton-agent/identity.json")"; config="$(sha256sum "$root/etc/pluton-agent.env")"
	if PLUTON_AGENT_TEST_MODE=1 PLUTON_AGENT_TEST_ROOT="$root" PLUTON_AGENT_TEST_CONTROL_PLANE_FAIL=1 "$INSTALLER" --server https://replacement.example.internal --allowed-root "$root/source" > "$root/failure.log" 2>&1; then fail 'Cache rollback fixture succeeded unexpectedly.'; fi
	grep -F 'configuration-only reinstall' "$root/failure.log" >/dev/null || fail 'Rollback test did not exercise verified reuse.'
	[[ "$before" == "$(sha256sum "$root/opt/pluton-agent/.verified-install")" && "$identity" == "$(sha256sum "$root/var/lib/pluton-agent/identity.json")" && "$config" == "$(sha256sum "$root/etc/pluton-agent.env")" ]] || fail 'Verified reuse rollback changed prior tree/config/identity.'
}

test_changed_source_reuses_tools_but_rebuilds_app() {
	local root output
	root="$(make_root source-rebuild)"; base_install "$root"
	sed -i 's/^source=.*/source=not-current-source/' "$root/opt/pluton-agent/.verified-install"
	output="$(base_install "$root")"
	[[ "$output" == *'Reusing root-protected'* && "$output" != *'Reusing verified application build'* ]] || fail 'Source change did not rebuild application with verified tools.'
	assert_private_runtime_access "$root"
}

test_fresh_install_and_generated_files
test_reinstall_preserves_identity_and_private_runtime_access
test_failed_update_restores_previous_installation
test_failed_reenrollment_restores_previous_installation
test_http_requires_explicit_opt_in
test_quick_enrollment_token_is_accepted_without_persistence
test_conflicting_enrollment_token_inputs_are_rejected
test_multiple_roots_and_private_ca_configuration
test_platform_rejections
test_checksum_mismatch_is_rejected
test_private_binary_checksum_mismatch_is_rejected
test_uninstall_and_purge
test_verified_configuration_only_reinstall_reuses_application
test_cache_rejects_unverified_or_tampered_install
test_verified_reuse_rollback_preserves_previous_tree
test_changed_source_reuses_tools_but_rebuilds_app
printf 'PASS: install-agent installer tests\n'
