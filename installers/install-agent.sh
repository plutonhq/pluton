#!/usr/bin/env bash
# Installs the independently developed, outbound-only Pluton community agent.
# It deliberately never changes the host Node.js, npm, or Docker configuration.

set -Eeuo pipefail
IFS=$'\n\t'

readonly AGENT_USER='pluton-agent'
readonly AGENT_GROUP='pluton-agent'
readonly SERVICE_NAME='pluton-agent.service'
readonly NODE_VERSION='v22.18.0'
readonly NODE_DIST_BASE='https://nodejs.org/dist'
readonly RESTIC_VERSION='0.19.1'
readonly RCLONE_VERSION='1.75.1'
readonly RESTIC_RELEASE_BASE="https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}"
readonly RCLONE_RELEASE_BASE="https://downloads.rclone.org/v${RCLONE_VERSION}"
# Pinned release digests keep the private data-plane binaries independently
# verifiable even if a remote checksum index is replaced.
readonly RESTIC_LINUX_AMD64_SHA256='f415415624dcc452f2a02b8c33641791a8c6d6d3b65bbb3543fcf9a25151585c'
readonly RCLONE_LINUX_AMD64_SHA256='982b5aa772841168f8e380f139e9e787b2a105403e32b94da8676a0e1c0a13ab'

ACTION='install'
SERVER_URL=''
CA_FILE=''
ALLOW_INSECURE_HTTP='false'
ENROLLMENT_TOKEN=''
TOKEN_STDIN='false'
REENROLL='false'
PURGE='false'
FORCE='false'
declare -a REQUESTED_ROOTS=()
declare -a ALLOWED_ROOTS=()

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
TEST_MODE="${PLUTON_AGENT_TEST_MODE:-0}"
STAGE_ROOT=''
REENROLL_BACKUP=''
INSTALL_ROOT=''
INSTALL_PARENT=''
RUNTIME_DIR=''
APP_DIR=''
BIN_DIR=''
STATE_DIR=''
CONFIG_FILE=''
SYSTEMD_UNIT=''
PREVIOUS_INSTALL_ROOT=''
PREVIOUS_CONFIG_FILE=''
PREVIOUS_SYSTEMD_UNIT=''
SERVICE_WAS_ACTIVE='false'
NODE_ARCHIVE_SHA256=''
REUSED_TOOLCHAIN='false'

log() {
	printf '[pluton-agent-installer] %s\n' "$*"
}

fail() {
	printf '[pluton-agent-installer] Error: %s\n' "$*" >&2
	exit 1
}

usage() {
	cat <<'EOF'
Usage:
  sudo ./installers/install-agent.sh --server <https://server> --allowed-root <absolute-path> [options]
  sudo ./installers/install-agent.sh uninstall [--purge] [--force]

Install options:
  --server <url>               Pluton server origin reachable by this host.
  --allowed-root <path>        Absolute source root; repeat for additional roots.
  --allow-insecure-http        Required only for an explicitly trusted-LAN HTTP server.
  --ca-file <path>             PEM file for a private HTTPS CA.
  --token <token>              Quick install only; exposes the one-time token to shell history/process listings.
  --token-stdin                Read the one-time enrollment token from standard input.
  --re-enroll                  Replace an existing local identity after confirmation.
  --force                      Skip the confirmation required by --re-enroll or uninstall --purge.
  --help                       Show this help.

The default enrollment flow asks for the one-time token from the terminal
without placing it in an argument or shell history.
EOF
}

is_test_mode() {
	[[ "$TEST_MODE" == '1' ]]
}

create_directory() {
	local mode="$1"
	local pathname="$2"
	mkdir -p -- "$pathname"
	if ! is_test_mode; then chmod "$mode" -- "$pathname"; fi
}

configure_paths() {
	if is_test_mode; then
		: "${PLUTON_AGENT_TEST_ROOT:?PLUTON_AGENT_TEST_ROOT is required in test mode}"
		mkdir -p -- "$PLUTON_AGENT_TEST_ROOT"
		local test_root
		test_root="$(cd -- "$PLUTON_AGENT_TEST_ROOT" && pwd -P)"
		case "$(basename -- "$test_root")" in
			.pluton-agent-test.*) ;;
			*) fail 'test mode requires a dedicated .pluton-agent-test.* root.' ;;
		esac
		INSTALL_ROOT="$test_root/opt/pluton-agent"
		STATE_DIR="$test_root/var/lib/pluton-agent"
		CONFIG_FILE="$test_root/etc/pluton-agent.env"
		SYSTEMD_UNIT="$test_root/etc/systemd/system/$SERVICE_NAME"
	else
		INSTALL_ROOT='/opt/pluton-agent'
		STATE_DIR='/var/lib/pluton-agent'
		CONFIG_FILE='/etc/pluton-agent.env'
		SYSTEMD_UNIT="/etc/systemd/system/$SERVICE_NAME"
	fi
	INSTALL_PARENT="$(dirname -- "$INSTALL_ROOT")"
	RUNTIME_DIR="$INSTALL_ROOT/runtime"
	APP_DIR="$INSTALL_ROOT/app"
	BIN_DIR="$INSTALL_ROOT/bin"
}

parse_arguments() {
	while (($#)); do
		case "$1" in
			uninstall)
				[[ "$ACTION" == 'install' ]] || fail 'uninstall may only be specified once.'
				ACTION='uninstall'
				shift
				;;
			--server)
				[[ $# -ge 2 ]] || fail '--server requires a URL.'
				SERVER_URL="$2"
				shift 2
				;;
			--allowed-root)
				[[ $# -ge 2 ]] || fail '--allowed-root requires an absolute path.'
				REQUESTED_ROOTS+=("$2")
				shift 2
				;;
			--allow-insecure-http)
				ALLOW_INSECURE_HTTP='true'
				shift
				;;
			--ca-file)
				[[ $# -ge 2 ]] || fail '--ca-file requires a file path.'
				CA_FILE="$2"
				shift 2
				;;
			--token)
				[[ $# -ge 2 ]] || fail '--token requires a one-time enrollment token.'
				[[ -z "$ENROLLMENT_TOKEN" ]] || fail '--token may only be specified once.'
				[[ -n "$2" && "$2" != *[[:space:]]* ]] || fail '--token requires a non-empty token without whitespace.'
				ENROLLMENT_TOKEN="$2"
				shift 2
				;;
			--token-stdin)
				TOKEN_STDIN='true'
				shift
				;;
			--re-enroll)
				REENROLL='true'
				shift
				;;
			--purge)
				PURGE='true'
				shift
				;;
			--force)
				FORCE='true'
				shift
				;;
			--help|-h)
				usage
				exit 0
				;;
			*)
				fail "Unknown option: $1"
				;;
		esac
	done
	if [[ "$ACTION" != 'uninstall' && "$PURGE" == 'true' ]]; then
		fail '--purge is only valid with uninstall.'
	fi
	if [[ -n "$ENROLLMENT_TOKEN" && "$TOKEN_STDIN" == 'true' ]]; then
		fail 'Choose either --token or --token-stdin.'
	fi
}

require_root() {
	if is_test_mode; then return; fi
	[[ "${EUID}" -eq 0 ]] || fail 'Run this installer with sudo or as root.'
}

require_commands() {
	local -a commands=(awk bzip2 cat chmod chown cp curl dirname getent grep groupadd head id install mktemp mv realpath rm runuser sed sha256sum systemctl tar uname unzip useradd)
	local command
	for command in "${commands[@]}"; do
		command -v "$command" >/dev/null 2>&1 || fail "Required utility is unavailable: $command"
	done
}

validate_platform() {
	if is_test_mode; then
		[[ "${PLUTON_AGENT_TEST_ARCH:-x86_64}" == 'x86_64' ]] || fail 'Unsupported architecture. This installer currently supports x86_64 only; arm64 can be added as a separate target.'
		[[ "${PLUTON_AGENT_TEST_SYSTEMD:-present}" == 'present' ]] || fail 'systemd is required for this installer.'
		return
	fi

	require_commands
	[[ -r /etc/os-release ]] || fail 'Could not identify the operating system.'
	# shellcheck disable=SC1091
	. /etc/os-release
	case "${ID:-}" in
		ubuntu|debian|linuxmint|pop) ;;
		*)
			[[ " ${ID_LIKE:-} " == *' debian '* ]] || fail 'Unsupported operating system. Ubuntu/Debian-family systems are supported initially.'
			;;
	esac
	case "$(uname -m)" in
		x86_64|amd64) ;;
		*) fail 'Unsupported architecture. This installer currently supports x86_64 only; arm64 can be added as a separate target.' ;;
	esac
	systemctl --version >/dev/null 2>&1 || fail 'systemd is required for this installer.'
	[[ -d /run/systemd/system ]] || fail 'systemd must be the active service manager on this host.'
}

validate_server_url() {
	[[ -n "$SERVER_URL" ]] || fail '--server is required.'
	[[ "$SERVER_URL" != *[[:space:]]* && "$SERVER_URL" != *'#'* && "$SERVER_URL" != *'?'* ]] || fail 'The server URL must not contain whitespace, fragments, or query parameters.'
	local scheme remainder authority path_part
	case "$SERVER_URL" in
		https://*) scheme='https' ;;
		http://*) scheme='http' ;;
		*) fail 'The server URL must be an absolute HTTP or HTTPS URL.' ;;
	esac
	remainder="${SERVER_URL#*://}"
	if [[ "$remainder" == */* ]]; then
		authority="${remainder%%/*}"
		path_part="/${remainder#*/}"
	else
		authority="$remainder"
		path_part=''
	fi
	[[ -n "$authority" && "$authority" != *'@'* ]] || fail 'The server URL must not contain credentials.'
	[[ -z "$path_part" || "$path_part" == '/' ]] || fail 'The server URL must be an origin without a path.'
	if [[ "$scheme" == 'http' && "$ALLOW_INSECURE_HTTP" != 'true' ]]; then
		fail 'HTTP requires --allow-insecure-http and must only be used for a trusted LAN.'
	fi
	if [[ "$scheme" == 'https' && "$ALLOW_INSECURE_HTTP" == 'true' ]]; then
		fail '--allow-insecure-http is only valid with an HTTP server URL.'
	fi
	SERVER_URL="${SERVER_URL%/}"
}

validate_allowed_roots() {
	((${#REQUESTED_ROOTS[@]} > 0)) || fail 'At least one --allowed-root is required.'
	local root canonical existing duplicate
	for root in "${REQUESTED_ROOTS[@]}"; do
		[[ "$root" == /* ]] || fail "Allowed roots must be absolute: $root"
		[[ "$root" != *','* && ! "$root" =~ [[:cntrl:]] && ! "$root" =~ (password|token|secret|credential|key)= && "$root" != *'://'* ]] || fail 'Allowed roots contain unsafe diagnostic characters.'
		case "$root/" in
			*'/../'*) fail "Allowed roots cannot contain parent traversal: $root" ;;
		esac
		canonical="$(realpath -e -- "$root")" || fail "Allowed root does not exist: $root"
		[[ -d "$canonical" ]] || fail "Allowed root must be a directory: $root"
		if [[ "$root" != "$canonical" ]]; then log "Source alias resolves to canonical path: $root -> $canonical"; fi
		duplicate='false'
		for existing in "${ALLOWED_ROOTS[@]}"; do
			if [[ "$existing" == "$canonical" ]]; then
				duplicate='true'
				break
			fi
		done
		if [[ "$duplicate" == 'false' ]]; then ALLOWED_ROOTS+=("$canonical"); fi
	done
}

join_allowed_roots() {
	local IFS=','
	printf '%s' "${ALLOWED_ROOTS[*]}"
}

ensure_agent_account() {
	if is_test_mode; then
		create_directory 0700 "$STATE_DIR"
		return
	fi
	if ! getent group "$AGENT_GROUP" >/dev/null; then
		groupadd --system "$AGENT_GROUP"
	fi
	if ! id -u "$AGENT_USER" >/dev/null 2>&1; then
		useradd --system --gid "$AGENT_GROUP" --home-dir "$STATE_DIR" --shell /usr/sbin/nologin --no-create-home "$AGENT_USER"
	fi
	[[ "$(id -u "$AGENT_USER")" != '0' ]] || fail 'The pluton-agent account must not be root.'
	local groups forbidden
	groups="$(id -nG "$AGENT_USER")"
	for forbidden in docker root sudo wheel; do
		[[ " $groups " != *" $forbidden "* ]] || fail "The pluton-agent account must not belong to the $forbidden group."
	done
	install -d -o "$AGENT_USER" -g "$AGENT_GROUP" -m 0700 -- "$STATE_DIR"
}

validate_agent_access_to_roots() {
	if is_test_mode; then return; fi
	local root parent component
	for root in "${ALLOWED_ROOTS[@]}"; do
		parent='/'; local remainder="${root#/}"
		while [[ "$remainder" == */* ]]; do
			component="${remainder%%/*}"; remainder="${remainder#*/}"
			parent="${parent%/}/$component"
			runuser -u "$AGENT_USER" -- test -x "$parent" || fail "source-parent-not-traversable: pluton-agent cannot traverse $parent (canonical source $root). Review narrowly scoped read-only access; installer did not change permissions."
		done
		runuser -u "$AGENT_USER" -- test -x "$root" || fail "The pluton-agent account cannot traverse allowed root: $root"
		runuser -u "$AGENT_USER" -- test -r "$root" || fail "source-root-not-readable: pluton-agent cannot read canonical source $root. Review read-only access; installer did not change permissions."
	done
	if [[ -n "$CA_FILE" ]]; then
		[[ "$CA_FILE" == /* && -f "$CA_FILE" ]] || fail '--ca-file must be an existing absolute file.'
		runuser -u "$AGENT_USER" -- test -r "$CA_FILE" || fail 'The pluton-agent account cannot read --ca-file.'
	fi
}

preserve_existing_optional_config() {
	[[ -z "$CA_FILE" && -f "$CONFIG_FILE" ]] || return 0
	local encoded
	encoded="$(sed -n 's/^PLUTON_AGENT_CA_FILE="\(.*\)"$/\1/p' "$CONFIG_FILE" | head -n 1)"
	[[ -n "$encoded" ]] || return 0
	encoded="${encoded//\\\"/\"}"
	CA_FILE="${encoded//\\\\/\\}"
	log 'Preserving the existing private CA configuration.'
}

cleanup_stage() {
	local exit_status="$?"
	if [[ -n "${PREVIOUS_INSTALL_ROOT:-}" && -e "$PREVIOUS_INSTALL_ROOT" ]]; then
		log 'Installation did not complete; restoring the previous agent application.'
		rm -rf -- "$INSTALL_ROOT"
		mv -- "$PREVIOUS_INSTALL_ROOT" "$INSTALL_ROOT"
		PREVIOUS_INSTALL_ROOT=''
	fi
	if [[ -n "${PREVIOUS_CONFIG_FILE:-}" && -f "$PREVIOUS_CONFIG_FILE" ]]; then
		mv -f -- "$PREVIOUS_CONFIG_FILE" "$CONFIG_FILE"
		PREVIOUS_CONFIG_FILE=''
	fi
	if [[ -n "${PREVIOUS_SYSTEMD_UNIT:-}" && -f "$PREVIOUS_SYSTEMD_UNIT" ]]; then
		mv -f -- "$PREVIOUS_SYSTEMD_UNIT" "$SYSTEMD_UNIT"
		PREVIOUS_SYSTEMD_UNIT=''
	fi
	if [[ -n "${REENROLL_BACKUP:-}" && -f "$REENROLL_BACKUP" ]]; then
		local identity_path
		identity_path="${REENROLL_BACKUP%.reenroll-backup.*}"
		if [[ ! -f "$identity_path" ]]; then
			mv -- "$REENROLL_BACKUP" "$identity_path"
		fi
	fi
	if ! is_test_mode && [[ "$exit_status" -ne 0 && "$SERVICE_WAS_ACTIVE" == 'true' && -d "$INSTALL_ROOT" ]]; then
		systemctl daemon-reload || log 'Could not reload systemd while restoring the previous agent.'
		systemctl start "$SERVICE_NAME" || log 'Could not restart the previous agent service automatically.'
	fi
	if [[ -n "${STAGE_ROOT:-}" && -d "$STAGE_ROOT" ]]; then
		rm -rf -- "$STAGE_ROOT"
	fi
	return "$exit_status"
}

backup_existing_file() {
	local source_path="$1" backup_path="$2" label="$3"
	[[ -e "$source_path" ]] || return
	[[ -f "$source_path" && ! -L "$source_path" ]] || fail "Existing $label must be a regular file: $source_path"
	cp -p -- "$source_path" "$backup_path"
}

prepare_update_rollback() {
	if [[ -f "$CONFIG_FILE" ]]; then
		PREVIOUS_CONFIG_FILE="${CONFIG_FILE}.previous.$$"
		backup_existing_file "$CONFIG_FILE" "$PREVIOUS_CONFIG_FILE" 'agent configuration'
	fi
	if [[ -f "$SYSTEMD_UNIT" ]]; then
		PREVIOUS_SYSTEMD_UNIT="${SYSTEMD_UNIT}.previous.$$"
		backup_existing_file "$SYSTEMD_UNIT" "$PREVIOUS_SYSTEMD_UNIT" 'systemd unit'
	fi
}

finalize_update() {
	if [[ -n "$PREVIOUS_INSTALL_ROOT" ]]; then rm -rf -- "$PREVIOUS_INSTALL_ROOT"; fi
	if [[ -n "$PREVIOUS_CONFIG_FILE" ]]; then rm -f -- "$PREVIOUS_CONFIG_FILE"; fi
	if [[ -n "$PREVIOUS_SYSTEMD_UNIT" ]]; then rm -f -- "$PREVIOUS_SYSTEMD_UNIT"; fi
	PREVIOUS_INSTALL_ROOT=''
	PREVIOUS_CONFIG_FILE=''
	PREVIOUS_SYSTEMD_UNIT=''
}

create_stage_root() {
	create_directory 0755 "$INSTALL_PARENT"
	STAGE_ROOT="$(mktemp -d "$INSTALL_PARENT/.pluton-agent-stage.XXXXXX")"
	trap cleanup_stage EXIT
}

verify_node_checksum() {
	local archive="$1"
	local checksums="$2"
	local filename expected
	filename="$(basename -- "$archive")"
	expected="$(awk -v filename="$filename" '$2 == filename || $2 == "*" filename { print $1; exit }' "$checksums")"
	[[ -n "$expected" ]] || return 1
	(
		cd -- "$(dirname -- "$archive")"
		printf '%s  %s\n' "$expected" "$filename" | sha256sum --check --status -
	)
}

verify_pinned_checksum() {
	local archive="$1" expected="$2" filename
	filename="$(basename -- "$archive")"
	(
		cd -- "$(dirname -- "$archive")"
		printf '%s  %s\n' "$expected" "$filename" | sha256sum --check --status -
	)
}

prepare_private_node_runtime() {
	create_directory 0755 "$STAGE_ROOT/runtime"
	if is_test_mode; then
		create_directory 0755 "$STAGE_ROOT/runtime/bin"
		printf '#!/usr/bin/env sh\nprintf "v22.18.0\\n"\n' > "$STAGE_ROOT/runtime/bin/node"
		chmod 0755 -- "$STAGE_ROOT/runtime/bin/node"
		NODE_ARCHIVE_SHA256='test-mode-no-archive'
		return
	fi

	local download_dir archive checksums distribution extracted
	download_dir="$(mktemp -d)"
	distribution="node-${NODE_VERSION}-linux-x64.tar.xz"
	archive="$download_dir/$distribution"
	checksums="$download_dir/SHASUMS256.txt"
	log "Downloading the private Node.js ${NODE_VERSION} runtime."
	curl --fail --location --proto '=https' --tlsv1.2 --output "$archive" "$NODE_DIST_BASE/$NODE_VERSION/$distribution"
	curl --fail --location --proto '=https' --tlsv1.2 --output "$checksums" "$NODE_DIST_BASE/$NODE_VERSION/SHASUMS256.txt"
	verify_node_checksum "$archive" "$checksums" || fail 'Node.js checksum verification failed; the archive was not extracted.'
	NODE_ARCHIVE_SHA256="$(sha256sum "$archive" | cut -d ' ' -f 1)"
	tar -xJf "$archive" -C "$download_dir"
	extracted="$download_dir/node-${NODE_VERSION}-linux-x64"
	[[ -x "$extracted/bin/node" ]] || fail 'The verified Node.js archive did not contain an executable runtime.'
	cp -a -- "$extracted/." "$STAGE_ROOT/runtime/"
	rm -rf -- "$download_dir"
}

prepare_private_backup_binaries() {
	create_directory 0755 "$STAGE_ROOT/bin"
	if is_test_mode; then
		printf '#!/usr/bin/env sh\nprintf "restic 0.19.1\\n"\n' > "$STAGE_ROOT/bin/restic"
		printf '#!/usr/bin/env sh\nprintf "rclone v1.75.1\\n"\n' > "$STAGE_ROOT/bin/rclone"
		chmod 0755 -- "$STAGE_ROOT/bin/restic" "$STAGE_ROOT/bin/rclone"
		return
	fi

	local download_dir restic_archive rclone_archive rclone_dir
	download_dir="$(mktemp -d)"
	restic_archive="$download_dir/restic_${RESTIC_VERSION}_linux_amd64.bz2"
	rclone_archive="$download_dir/rclone-v${RCLONE_VERSION}-linux-amd64.zip"
	log "Downloading private Restic ${RESTIC_VERSION} and Rclone ${RCLONE_VERSION} binaries."
	curl --fail --location --proto '=https' --tlsv1.2 --output "$restic_archive" "$RESTIC_RELEASE_BASE/$(basename -- "$restic_archive")"
	curl --fail --location --proto '=https' --tlsv1.2 --output "$rclone_archive" "$RCLONE_RELEASE_BASE/$(basename -- "$rclone_archive")"
	verify_pinned_checksum "$restic_archive" "$RESTIC_LINUX_AMD64_SHA256" || fail 'Restic checksum verification failed; the archive was not extracted.'
	verify_pinned_checksum "$rclone_archive" "$RCLONE_LINUX_AMD64_SHA256" || fail 'Rclone checksum verification failed; the archive was not extracted.'
	bzip2 -dc -- "$restic_archive" > "$STAGE_ROOT/bin/restic"
	unzip -q "$rclone_archive" -d "$download_dir/rclone"
	rclone_dir="$download_dir/rclone/rclone-v${RCLONE_VERSION}-linux-amd64"
	[[ -x "$rclone_dir/rclone" ]] || fail 'The verified Rclone archive did not contain its executable.'
	install -m 0755 -- "$rclone_dir/rclone" "$STAGE_ROOT/bin/rclone"
	chmod 0755 -- "$STAGE_ROOT/bin/restic"
	"$STAGE_ROOT/bin/restic" version >/dev/null || fail 'The private Restic binary could not be executed.'
	"$STAGE_ROOT/bin/rclone" version >/dev/null || fail 'The private Rclone binary could not be executed.'
	rm -rf -- "$download_dir"
}

build_agent_app_from_source() {
	create_directory 0755 "$STAGE_ROOT/app"
	if is_test_mode; then
		create_directory 0755 "$STAGE_ROOT/app/dist"
		printf 'console.log("test agent");\n' > "$STAGE_ROOT/app/dist/index.js"
		printf '{"name":"@plutonhq/pluton-agent"}\n' > "$STAGE_ROOT/app/package.json"
		return
	fi

	[[ -f "$REPOSITORY_ROOT/package.json" && -f "$REPOSITORY_ROOT/pnpm-lock.yaml" && -f "$REPOSITORY_ROOT/pnpm-workspace.yaml" && -f "$REPOSITORY_ROOT/agent/package.json" ]] || fail 'Run the installer from a complete cloned Pluton repository.'
	local build_dir corepack_js
	build_dir="$(mktemp -d)"
	cp -- "$REPOSITORY_ROOT/package.json" "$REPOSITORY_ROOT/pnpm-lock.yaml" "$REPOSITORY_ROOT/pnpm-workspace.yaml" "$build_dir/"
	mkdir -p -- "$build_dir/agent"
	(
		cd -- "$REPOSITORY_ROOT/agent"
		tar --exclude='./node_modules' --exclude='./dist' --exclude='./.turbo' -cf - .
	) | tar -C "$build_dir/agent" -xf -

	corepack_js="$STAGE_ROOT/runtime/lib/node_modules/corepack/dist/corepack.js"
	[[ -f "$corepack_js" ]] || fail 'The private Node.js runtime did not include Corepack.'
	(
		cd -- "$build_dir"
		export HOME="$build_dir/.home"
		mkdir -p -- "$HOME"
		export COREPACK_HOME="$build_dir/.corepack"
		export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
		export XDG_CACHE_HOME="$build_dir/.cache"
		export XDG_CONFIG_HOME="$build_dir/.config"
		export XDG_DATA_HOME="$build_dir/.data"
		"$STAGE_ROOT/runtime/bin/node" "$corepack_js" pnpm install --frozen-lockfile --ignore-scripts --filter @plutonhq/pluton-agent...
		"$STAGE_ROOT/runtime/bin/node" "$corepack_js" pnpm --filter @plutonhq/pluton-agent build
	)
	[[ -d "$build_dir/agent/dist" ]] || fail 'The agent build did not create dist output.'
	if ! "$STAGE_ROOT/runtime/bin/node" -e 'const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.exit(Object.keys(p.dependencies || {}).length ? 1 : 0)' "$build_dir/agent/package.json"; then
		fail 'The agent now has runtime dependencies; extend the installer artifact step before installing it.'
	fi
	cp -a -- "$build_dir/agent/dist" "$STAGE_ROOT/app/dist"
	install -m 0644 -- "$build_dir/agent/package.json" "$STAGE_ROOT/app/package.json"
	rm -rf -- "$build_dir"
}

source_fingerprint() {
	(
		cd -- "$REPOSITORY_ROOT"
		[[ -f package.json && -f pnpm-lock.yaml && -f pnpm-workspace.yaml && -f agent/package.json && -f agent/tsconfig.json ]] || return 1
		# Source links would make a source-only fingerprint incomplete; refuse reuse.
		[[ -z "$(find agent/src -type l -print -quit)" ]] || return 1
		{ printf '%s\0' package.json pnpm-lock.yaml pnpm-workspace.yaml agent/package.json agent/tsconfig.json; find agent/src -type f -print0; } | sort -z | xargs -0 sha256sum | sha256sum | cut -d ' ' -f 1
	)
}

verified_tree_digest() {
	local root="$1" entry owner mode target expected_owner=0
	if is_test_mode; then expected_owner="$(id -u)"; fi
	(
		cd -- "$root" || return 1
		[[ -d runtime && -d bin && -d app && ! -L runtime && ! -L bin && ! -L app ]] || return 1
		while IFS= read -r -d '' entry; do
			[[ ! "$entry" =~ [[:cntrl:]] ]] || return 1
			owner="$(stat -c '%u' -- "$entry")"; [[ "$owner" == "$expected_owner" ]] || return 1
			if [[ -L "$entry" ]]; then
				target="$(realpath -e -- "$entry")" || return 1
				[[ "$target" == "$root/runtime/"* || "$target" == "$root/bin/"* || "$target" == "$root/app/"* ]] || return 1
				printf 'link %s %s\n' "$entry" "$(readlink -- "$entry")"
			elif [[ -d "$entry" || -f "$entry" ]]; then
				mode="$(stat -c '%a' -- "$entry")"
				(( (8#$mode & 0022) == 0 )) || return 1
				if [[ -d "$entry" ]]; then (( (8#$mode & 0005) == 0005 )) || return 1; fi
				printf 'mode %s %s\n' "$mode" "$entry"
				if [[ -f "$entry" ]]; then sha256sum -- "$entry"; fi
			else return 1; fi
		done < <(find runtime bin app -print0 | sort -z)
	) | sha256sum | cut -d ' ' -f 1
}

try_reuse_verified_install() {
	[[ -d "$INSTALL_ROOT" && ! -L "$INSTALL_ROOT" && -f "$INSTALL_ROOT/.verified-install" && ! -L "$INSTALL_ROOT/.verified-install" ]] || return 1
	local expected_owner=0 current source_hash tree_hash metadata parent="$INSTALL_ROOT"
	if is_test_mode; then expected_owner="$(id -u)"; fi
	# Metadata and every ancestor must be protected from modification by the agent.
	while [[ "$parent" != '/' ]]; do
		[[ ! -L "$parent" && "$(stat -c '%u' -- "$parent")" == "$expected_owner" ]] || return 1
		local mode; mode="$(stat -c '%a' -- "$parent")"; (( (8#$mode & 0022) == 0 )) || return 1
		if is_test_mode && [[ "$parent" == "${PLUTON_AGENT_TEST_ROOT}" ]]; then break; fi
		parent="$(dirname -- "$parent")"
	done
	[[ "$(stat -c '%u' "$INSTALL_ROOT/.verified-install")" == "$expected_owner" ]] || return 1
	[[ "$(stat -c '%a' "$INSTALL_ROOT/.verified-install")" == '644' ]] || return 1
	metadata="$(<"$INSTALL_ROOT/.verified-install")"
	[[ "$metadata" == 'format=1'$'\n'* ]] || return 1
	[[ "$metadata" == *$'\n'"node=$NODE_VERSION"$'\n'"restic=$RESTIC_VERSION:$RESTIC_LINUX_AMD64_SHA256"$'\n'"rclone=$RCLONE_VERSION:$RCLONE_LINUX_AMD64_SHA256"$'\n'* ]] || return 1
	NODE_ARCHIVE_SHA256="$(sed -n 's/^node_archive=//p' "$INSTALL_ROOT/.verified-install")"
	if is_test_mode; then [[ "$NODE_ARCHIVE_SHA256" == 'test-mode-no-archive' ]] || return 1
	else [[ "$NODE_ARCHIVE_SHA256" =~ ^[a-f0-9]{64}$ ]] || return 1; fi
	tree_hash="$(verified_tree_digest "$INSTALL_ROOT")" || return 1
	grep -Fx "tree=$tree_hash" "$INSTALL_ROOT/.verified-install" >/dev/null || return 1
	# Execute only after ownership/mode/content validation, not just a version string.
	[[ "$("$INSTALL_ROOT/runtime/bin/node" -v)" == "$NODE_VERSION" ]] || return 1
	"$INSTALL_ROOT/bin/restic" version | grep -F "restic $RESTIC_VERSION" >/dev/null || return 1
	"$INSTALL_ROOT/bin/rclone" version | grep -F "rclone v$RCLONE_VERSION" >/dev/null || return 1
	cp -a -- "$INSTALL_ROOT/runtime" "$INSTALL_ROOT/bin" "$STAGE_ROOT/"
	REUSED_TOOLCHAIN='true'
	log 'Reusing root-protected, SHA-256/version-verified private runtime and binaries.'
	source_hash="$(source_fingerprint)" || source_hash='not-reusable'
	if [[ "$source_hash" != 'not-reusable' ]] && grep -Fx "source=$source_hash" "$INSTALL_ROOT/.verified-install" >/dev/null; then
		cp -a -- "$INSTALL_ROOT/app" "$STAGE_ROOT/"
		log 'Reusing verified application build; configuration-only reinstall.'
	else build_agent_app_from_source; fi
}

write_install_provenance() {
	local source_hash tree_hash
	source_hash="$(source_fingerprint)" || source_hash='not-reusable'
	tree_hash="$(verified_tree_digest "$STAGE_ROOT")" || fail 'Staged installation failed ownership/mode/integrity validation.'
	printf 'format=1\nnode=%s\nrestic=%s:%s\nrclone=%s:%s\nnode_archive=%s\nsource=%s\ntree=%s\n' "$NODE_VERSION" "$RESTIC_VERSION" "$RESTIC_LINUX_AMD64_SHA256" "$RCLONE_VERSION" "$RCLONE_LINUX_AMD64_SHA256" "$NODE_ARCHIVE_SHA256" "$source_hash" "$tree_hash" > "$STAGE_ROOT/.verified-install"
	chmod 0644 -- "$STAGE_ROOT/.verified-install"
}

stop_service_if_present() {
	if is_test_mode; then return; fi
	if [[ -f "$SYSTEMD_UNIT" ]]; then
		if systemctl is-active --quiet "$SERVICE_NAME"; then SERVICE_WAS_ACTIVE='true'; fi
		systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
	fi
}

activate_staged_files() {
	PREVIOUS_INSTALL_ROOT="$INSTALL_PARENT/.pluton-agent-previous.$$"
	normalize_staged_install_permissions
	write_install_provenance
	if [[ -e "$INSTALL_ROOT" ]]; then
		rm -rf -- "$PREVIOUS_INSTALL_ROOT"
		mv -- "$INSTALL_ROOT" "$PREVIOUS_INSTALL_ROOT"
	else
		PREVIOUS_INSTALL_ROOT=''
	fi
	mv -- "$STAGE_ROOT" "$INSTALL_ROOT"
	STAGE_ROOT=''
}

normalize_staged_install_permissions() {
	# mktemp deliberately creates the staging root as 0700.  Removing write
	# access alone preserves that mode and makes the moved install
	# inaccessible to the unprivileged agent.  Make every directory traversable
	# and readable, keep existing executable bits on binaries, and remove all
	# group/other write access before the tree becomes live.
	if ! is_test_mode; then
		chown -R root:root -- "$STAGE_ROOT"
	fi
	chmod -R a+rX,u+w,go-w -- "$STAGE_ROOT"
}

escape_environment_value() {
	local value="$1"
	value="${value//\\/\\\\}"
	value="${value//\"/\\\"}"
	printf '%s' "$value"
}

write_config() {
	local roots temporary
	roots="$(join_allowed_roots)"
	create_directory 0755 "$(dirname -- "$CONFIG_FILE")"
	temporary="${CONFIG_FILE}.tmp.$$"
	(
		umask 077
		{
			printf 'PLUTON_SERVER_URL="%s"\n' "$(escape_environment_value "$SERVER_URL")"
			printf 'PLUTON_AGENT_DATA_DIR="%s"\n' "$(escape_environment_value "$STATE_DIR")"
			printf 'PLUTON_AGENT_BIN_DIR="%s"\n' "$(escape_environment_value "$BIN_DIR")"
			printf 'PLUTON_AGENT_ALLOWED_ROOTS="%s"\n' "$(escape_environment_value "$roots")"
			printf 'ALLOW_INSECURE_HTTP="%s"\n' "$ALLOW_INSECURE_HTTP"
			if [[ -n "$CA_FILE" ]]; then
				printf 'PLUTON_AGENT_CA_FILE="%s"\n' "$(escape_environment_value "$CA_FILE")"
			fi
		} > "$temporary"
	)
	if ! is_test_mode; then
		chmod 0600 -- "$temporary"
		chown root:root -- "$temporary"
	fi
	mv -- "$temporary" "$CONFIG_FILE"
}

write_systemd_unit() {
	create_directory 0755 "$(dirname -- "$SYSTEMD_UNIT")"
	cat > "$SYSTEMD_UNIT" <<EOF
[Unit]
Description=Pluton remote agent
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=$AGENT_USER
Group=$AGENT_GROUP
EnvironmentFile=$CONFIG_FILE
ExecStart=$RUNTIME_DIR/bin/node $APP_DIR/dist/index.js run
Restart=on-failure
RestartSec=10s
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ReadWritePaths=$STATE_DIR
CapabilityBoundingSet=
RestrictSUIDSGID=yes
LockPersonality=yes
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
	if ! is_test_mode; then chmod 0644 -- "$SYSTEMD_UNIT"; fi
}

agent_command_arguments() {
	local mode="$1"
	local roots
	roots="$(join_allowed_roots)"
	AGENT_COMMAND=("$mode" --server "$SERVER_URL" --data-dir "$STATE_DIR" --bin-dir "$BIN_DIR" --allowed-roots "$roots")
	if [[ "$ALLOW_INSECURE_HTTP" == 'true' ]]; then AGENT_COMMAND+=(--allow-insecure-http); fi
	if [[ -n "$CA_FILE" ]]; then AGENT_COMMAND+=(--ca-file "$CA_FILE"); fi
}

confirm_destructive_action() {
	local action_label="$1" confirmation
	if [[ "$FORCE" == 'true' ]]; then return; fi
	[[ -r /dev/tty ]] || fail "$action_label requires an interactive confirmation or --force."
	printf 'Type %s to continue: ' "$action_label" > /dev/tty
	IFS= read -r confirmation < /dev/tty
	[[ "$confirmation" == "$action_label" ]] || fail "$action_label was not confirmed."
}

read_enrollment_token() {
	local token
	if [[ -n "$ENROLLMENT_TOKEN" ]]; then
		token="$ENROLLMENT_TOKEN"
	elif [[ "$TOKEN_STDIN" == 'true' ]]; then
		IFS= read -r token || true
	else
		[[ -r /dev/tty ]] || fail 'No interactive terminal is available. Use --token-stdin for automation.'
		printf 'Enrollment token: ' > /dev/tty
		IFS= read -r -s token < /dev/tty
		printf '\n' > /dev/tty
	fi
	[[ -n "$token" && "$token" != *[[:space:]]* ]] || fail 'A non-empty enrollment token is required.'
	printf '%s' "$token"
}

enroll_if_needed() {
	local identity="$STATE_DIR/identity.json"
	if [[ -f "$identity" && "$REENROLL" != 'true' ]]; then
		if [[ -n "$ENROLLMENT_TOKEN" || "$TOKEN_STDIN" == 'true' ]]; then
			log 'Existing agent identity found; the supplied enrollment credential was not used.'
		fi
		ENROLLMENT_TOKEN=''
		log 'Existing agent identity found; reusing it without enrolling a new device.'
		return
	fi
	if [[ -f "$identity" && "$REENROLL" == 'true' ]]; then
		confirm_destructive_action 'RE-ENROLL'
		REENROLL_BACKUP="${identity}.reenroll-backup.$$"
		mv -- "$identity" "$REENROLL_BACKUP"
		log 'Existing identity is held locally until the new enrollment succeeds. Revoke the old device explicitly in the Pluton UI if appropriate.'
	fi
	local token
	if is_test_mode; then
		if [[ -n "$ENROLLMENT_TOKEN" ]]; then
			token="$(read_enrollment_token)"
			ENROLLMENT_TOKEN=''
			unset token
		fi
		[[ "${PLUTON_AGENT_TEST_ENROLL_FAIL:-0}" != '1' ]] || fail 'Test enrollment failure.'
		printf '{"deviceId":"remote-test","agentId":"agent-test","secret":"test-only","pollIntervalSeconds":15,"completedCommands":[]}\n' > "$identity"
		return
	fi

	token="$(read_enrollment_token)"
	ENROLLMENT_TOKEN=''
	agent_command_arguments 'enroll'
	AGENT_COMMAND+=(--token-stdin)
	printf '%s\n' "$token" | runuser -u "$AGENT_USER" -- "$RUNTIME_DIR/bin/node" "$APP_DIR/dist/index.js" "${AGENT_COMMAND[@]}"
	unset token
	[[ -f "$identity" ]] || fail 'Enrollment did not create an agent identity.'
	if [[ -n "$REENROLL_BACKUP" ]]; then
		rm -f -- "$REENROLL_BACKUP"
		REENROLL_BACKUP=''
	fi
}

verify_control_plane() {
	if is_test_mode; then
		[[ "${PLUTON_AGENT_TEST_CONTROL_PLANE_FAIL:-0}" != '1' ]] || fail 'Test control-plane validation failure.'
		return
	fi
	agent_command_arguments 'check'
	runuser -u "$AGENT_USER" -- "$RUNTIME_DIR/bin/node" "$APP_DIR/dist/index.js" "${AGENT_COMMAND[@]}"
}

validate_installed_runtime_access() {
	# Validate the complete private data-plane toolchain as the service account
	# before enrollment or control-plane checks invoke the runtime themselves.
	# This catches parent-directory and executable-bit regressions while the
	# transaction is still protected by the rollback trap.
	if is_test_mode; then
		"$RUNTIME_DIR/bin/node" -v >/dev/null || fail 'The staged private Node runtime could not be executed.'
		"$BIN_DIR/restic" version >/dev/null || fail 'The staged private Restic binary could not be executed.'
		"$BIN_DIR/rclone" version >/dev/null || fail 'The staged private Rclone binary could not be executed.'
		return
	fi
	runuser -u "$AGENT_USER" -- "$RUNTIME_DIR/bin/node" -v >/dev/null || fail 'The pluton-agent account cannot execute the private Node runtime.'
	runuser -u "$AGENT_USER" -- "$BIN_DIR/restic" version >/dev/null || fail 'The pluton-agent account cannot execute the private Restic binary.'
	runuser -u "$AGENT_USER" -- "$BIN_DIR/rclone" version >/dev/null || fail 'The pluton-agent account cannot execute the private Rclone binary.'
}

enable_and_start_service() {
	if is_test_mode; then
		touch "${PLUTON_AGENT_TEST_ROOT}/service-active"
		return
	fi
	systemctl daemon-reload
	systemctl enable "$SERVICE_NAME" >/dev/null
	systemctl restart "$SERVICE_NAME"
	systemctl is-active --quiet "$SERVICE_NAME" || fail 'The service did not become active. Inspect: journalctl -u pluton-agent -n 100 --no-pager'
}

install_agent() {
	validate_server_url
	validate_allowed_roots
	validate_platform
	ensure_agent_account
	preserve_existing_optional_config
	validate_agent_access_to_roots
	create_stage_root
	prepare_update_rollback
	if ! try_reuse_verified_install; then
		log 'No reusable verified installation; performing pinned download/build.'
		prepare_private_node_runtime
		prepare_private_backup_binaries
		build_agent_app_from_source
	fi
	stop_service_if_present
	activate_staged_files
	validate_installed_runtime_access
	write_config
	enroll_if_needed
	verify_control_plane
	write_systemd_unit
	enable_and_start_service
	finalize_update
	log 'Installation complete. Check status with: systemctl status pluton-agent'
}

confirm_purge() {
	if [[ "$PURGE" != 'true' ]]; then return; fi
	confirm_destructive_action 'PURGE'
}

uninstall_agent() {
	confirm_purge
	if ! is_test_mode && [[ -f "$SYSTEMD_UNIT" ]]; then
		systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
		systemctl disable "$SERVICE_NAME" >/dev/null 2>&1 || true
	fi
	rm -f -- "$SYSTEMD_UNIT"
	if ! is_test_mode; then systemctl daemon-reload; fi
	rm -rf -- "$INSTALL_ROOT"
	if [[ "$PURGE" == 'true' ]]; then
		rm -rf -- "$STATE_DIR"
		rm -f -- "$CONFIG_FILE"
		log 'Agent application, configuration, and local identity were removed. No server-side device was revoked.'
	else
		log "Agent application was removed. The identity remains at $STATE_DIR/identity.json and no server-side device was revoked."
	fi
}

main() {
	configure_paths
	parse_arguments "$@"
	require_root
	if [[ "$ACTION" == 'uninstall' ]]; then
		uninstall_agent
	else
		install_agent
	fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
	main "$@"
fi
