#!/bin/bash
# Pluton Installation Script
# Installs Pluton as a systemd service running as the pluton system user

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Installation paths
INSTALL_DIR="/opt/pluton"
DATA_DIR="/var/lib/pluton"
CONFIG_DIR="/etc/pluton"
SERVICE_FILE="/etc/systemd/system/pluton.service"
ENV_FILE="${CONFIG_DIR}/pluton.env"
ENC_ENV_FILE="${CONFIG_DIR}/pluton.enc.env"
HELPER_BASE_URL="https://dl.usepluton.com/deps/pluton-helper/linux-helper"
HELPER_PATH="/usr/bin/pluton-helper"
PLUTON_USER="pluton"
PLUTON_GROUP="pluton"

# Default configuration
DEFAULT_PORT=5173
DEFAULT_MAX_CONCURRENT=2

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║           Pluton Backup Service - Installer               ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check for root privileges
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Error: This script must be run as root.${NC}"
    echo "Please run: sudo $0"
    exit 1
fi

missing=()
for cmd in curl setcap; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        missing+=("$cmd")
    fi
done

if [ ${#missing[@]} -gt 0 ]; then
    echo -e "${RED}Error: Missing required commands: ${missing[*]}${NC}"
    echo "Please install them and try again."
    exit 1
fi

detect_architecture() {
    local arch
    arch=$(uname -m)
    case "$arch" in
        x86_64|amd64)
            echo "x64"
            ;;
        aarch64|arm64)
            echo "arm64"
            ;;
        *)
            echo -e "${RED}Error: Unsupported architecture: $arch${NC}" >&2
            exit 1
            ;;
    esac
}

helper_url_for_arch() {
    local arch="$1"
    case "$arch" in
        x64)
            echo "${HELPER_BASE_URL}-${arch}"
            ;;
        arm64)
            echo "${HELPER_BASE_URL}-${arch}"
            ;;
        *)
            echo -e "${RED}Error: Unsupported helper architecture: $arch${NC}" >&2
            exit 1
            ;;
    esac
}

create_pluton_user() {
    echo "  Ensuring ${PLUTON_USER} system user exists..."
    if ! getent group "${PLUTON_GROUP}" >/dev/null 2>&1; then
        groupadd --system "${PLUTON_GROUP}"
    fi
    if ! id -u "${PLUTON_USER}" >/dev/null 2>&1; then
        useradd --system --gid "${PLUTON_GROUP}" --home-dir "${DATA_DIR}" --shell /usr/sbin/nologin "${PLUTON_USER}"
    fi
}

ensure_runtime_ownership() {
    echo "  Setting runtime directory ownership..."
    mkdir -p "${DATA_DIR}"/{config,db,logs,progress,stats,sync,cache,cache/restic,downloads,restores,rescue,backups}
    mkdir -p "${CONFIG_DIR}"
    chown -R "${PLUTON_USER}:${PLUTON_GROUP}" "${DATA_DIR}" "${CONFIG_DIR}"
    chmod 700 "${DATA_DIR}" "${CONFIG_DIR}" "${DATA_DIR}/config"
    chmod 755 "${DATA_DIR}/logs" "${DATA_DIR}/progress" "${DATA_DIR}/stats" "${DATA_DIR}/sync" "${DATA_DIR}/cache" "${DATA_DIR}/cache/restic" "${DATA_DIR}/downloads" "${DATA_DIR}/restores" "${DATA_DIR}/rescue" "${DATA_DIR}/backups"
}

install_pluton_helper() {
    local arch="$1"
    local helper_url
    helper_url=$(helper_url_for_arch "$arch")
    local helper_tmp
    helper_tmp=$(mktemp)

    echo "  Installing pluton-helper from ${helper_url}..."
    if ! curl -fSL --progress-bar -o "${helper_tmp}" "${helper_url}"; then
        rm -f "${helper_tmp}"
        echo -e "${RED}Error: Failed to download pluton-helper from ${helper_url}${NC}"
        exit 1
    fi

    install -o root -g "${PLUTON_GROUP}" -m 750 "${helper_tmp}" "${HELPER_PATH}"
    rm -f "${helper_tmp}"
    setcap cap_dac_override,cap_chown,cap_fowner+ep "${HELPER_PATH}"

    if ! getcap "${HELPER_PATH}" | grep -q 'cap_chown,cap_dac_override,cap_fowner=ep'; then
        echo -e "${RED}Error: Failed to apply required capabilities to ${HELPER_PATH}${NC}"
        exit 1
    fi

    if ! "${HELPER_PATH}" version >/dev/null 2>&1; then
        echo -e "${RED}Error: ${HELPER_PATH} failed version verification${NC}"
        exit 1
    fi
}

create_tool_wrappers() {
    local arch="$1"
    local platform_id="linux-${arch}"
    local restic_bin="${INSTALL_DIR}/binaries/${platform_id}/restic"
    local rclone_bin="${INSTALL_DIR}/binaries/${platform_id}/rclone"
    local rclone_config="${DATA_DIR}/config/rclone.conf"
    local system_bin_dir="/usr/local/bin"

    echo "  Creating system-wide wrappers 'prclone' and 'prestic'..."

    if [ ! -x "${restic_bin}" ] || [ ! -x "${rclone_bin}" ]; then
        echo -e "${YELLOW}Warning: Bundled restic/rclone binaries were not found for ${platform_id}; skipping wrappers.${NC}"
        return 0
    fi

    mkdir -p "${system_bin_dir}"

    cat > "${system_bin_dir}/prclone" << EOF
#!/bin/sh
# Pluton Wrapper for rclone
exec "${rclone_bin}" --config "${rclone_config}" "\$@"
EOF

    cat > "${system_bin_dir}/prestic" << EOF
#!/bin/sh
# Pluton Wrapper for restic
export RCLONE_CONFIG="${rclone_config}"
exec "${restic_bin}" -o rclone.program="${rclone_bin}" "\$@"
EOF

    chmod +x "${system_bin_dir}/prclone" "${system_bin_dir}/prestic"
}

# Get APPDIR (set by AppRun or passed as argument)
if [ -z "$APPDIR" ]; then
    APPDIR="$(dirname "$(readlink -f "$0")")/.."
fi

# Check if already installed
if systemctl is-active --quiet pluton 2>/dev/null; then
    echo -e "${YELLOW}Pluton service is already running.${NC}"
    read -p "Do you want to reinstall? This will stop the current service. [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Installation cancelled."
        exit 0
    fi
    echo "Stopping existing service..."
    systemctl stop pluton
    systemctl disable pluton
fi

# Configuration: Check for config file or prompt user
CONFIG_FILE="${APPDIR}/pluton-config.env"
if [ -f "$CONFIG_FILE" ]; then
    echo -e "${GREEN}Found configuration file: ${CONFIG_FILE}${NC}"
    source "$CONFIG_FILE"
    SERVER_PORT="${SERVER_PORT:-$DEFAULT_PORT}"
    MAX_CONCURRENT_BACKUPS="${MAX_CONCURRENT_BACKUPS:-$DEFAULT_MAX_CONCURRENT}"
else
    echo -e "${BLUE}Configuration Setup${NC}"
    echo "Press Enter to accept default values."
    echo ""
    
    # Server Port
    read -p "Server Port [${DEFAULT_PORT}]: " SERVER_PORT
    SERVER_PORT="${SERVER_PORT:-$DEFAULT_PORT}"
    
    # Validate port
    if ! [[ "$SERVER_PORT" =~ ^[0-9]+$ ]] || [ "$SERVER_PORT" -lt 1024 ] || [ "$SERVER_PORT" -gt 65535 ]; then
        echo -e "${RED}Error: Invalid port. Must be between 1024 and 65535.${NC}"
        exit 1
    fi
    
    # Max Concurrent Backups
    read -p "Max Concurrent Backups [${DEFAULT_MAX_CONCURRENT}]: " MAX_CONCURRENT_BACKUPS
    MAX_CONCURRENT_BACKUPS="${MAX_CONCURRENT_BACKUPS:-$DEFAULT_MAX_CONCURRENT}"
    
    # Validate max concurrent
    if ! [[ "$MAX_CONCURRENT_BACKUPS" =~ ^[0-9]+$ ]] || [ "$MAX_CONCURRENT_BACKUPS" -lt 1 ] || [ "$MAX_CONCURRENT_BACKUPS" -gt 10 ]; then
        echo -e "${RED}Error: Invalid value. Must be between 1 and 10.${NC}"
        exit 1
    fi
fi

echo ""
echo -e "${BLUE}Installing Pluton...${NC}"
ARCH=$(detect_architecture)
create_pluton_user

# Create installation directory
echo "  Creating installation directory: ${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}/binaries"
mkdir -p "${INSTALL_DIR}/node_modules"
mkdir -p "${INSTALL_DIR}/drizzle"

# Create data and config directories with subdirectories
ensure_runtime_ownership

# Copy executable
echo "  Copying executable..."
cp "${APPDIR}/usr/bin/pluton" "${INSTALL_DIR}/pluton"
chmod +x "${INSTALL_DIR}/pluton"

# Copy binaries (restic, rclone)
echo "  Copying binaries..."
if [ -d "${APPDIR}/usr/bin/binaries" ]; then
    cp -r "${APPDIR}/usr/bin/binaries"/* "${INSTALL_DIR}/binaries/"
    chmod +x "${INSTALL_DIR}/binaries"/*/*
fi

# Copy native modules (from usr/bin/node_modules where pkg expects them)
echo "  Copying native modules..."
if [ -d "${APPDIR}/usr/bin/node_modules" ]; then
    cp -r "${APPDIR}/usr/bin/node_modules"/* "${INSTALL_DIR}/node_modules/"
fi

# Copy drizzle migrations
echo "  Copying database migrations..."
if [ -d "${APPDIR}/usr/bin/drizzle" ]; then
    cp -r "${APPDIR}/usr/bin/drizzle"/* "${INSTALL_DIR}/drizzle/"
fi

chown -R root:root "${INSTALL_DIR}"
chmod 755 "${INSTALL_DIR}"
find "${INSTALL_DIR}" -type d -exec chmod 755 {} \;
find "${INSTALL_DIR}" -type f -exec chmod 644 {} \;
chmod 755 "${INSTALL_DIR}/pluton"
find "${INSTALL_DIR}/binaries" -type f -exec chmod 755 {} \; 2>/dev/null || true

create_tool_wrappers "${ARCH}"
install_pluton_helper "${ARCH}"

# Write configuration file
echo "  Writing configuration..."
cat > "${DATA_DIR}/config/config.json" << EOF
{
  "SERVER_PORT": ${SERVER_PORT},
  "MAX_CONCURRENT_BACKUPS": ${MAX_CONCURRENT_BACKUPS}
}
EOF
chown "${PLUTON_USER}:${PLUTON_GROUP}" "${DATA_DIR}/config/config.json"
chmod 600 "${DATA_DIR}/config/config.json"

echo "  Writing environment placeholders..."
{
    printf '# Pluton credentials\n'
    printf 'PLUTON_USER_NAME=%s\n' "${PLUTON_USER_NAME:-}"
    printf 'PLUTON_USER_PASSWORD=%s\n' "${PLUTON_USER_PASSWORD:-}"
} > "${ENV_FILE}"
chmod 600 "${ENV_FILE}"

if [ ! -f "${ENC_ENV_FILE}" ]; then
    {
        printf '# Pluton Encryption Key - setup wizard may populate this file\n'
        printf 'PLUTON_ENCRYPTION_KEY=%s\n' "${PLUTON_ENCRYPTION_KEY:-}"
    } > "${ENC_ENV_FILE}"
fi
chown "${PLUTON_USER}:${PLUTON_GROUP}" "${ENV_FILE}" "${ENC_ENV_FILE}"
chmod 600 "${ENV_FILE}" "${ENC_ENV_FILE}"

# Create systemd service file
echo "  Creating systemd service..."
cat > "${SERVICE_FILE}" << EOF
[Unit]
Description=Pluton Backup Service
After=network.target

[Service]
Type=simple
ExecStart=${INSTALL_DIR}/pluton
WorkingDirectory=${DATA_DIR}
User=${PLUTON_USER}
Group=${PLUTON_GROUP}
Restart=on-failure
RestartSec=5
StandardOutput=append:${DATA_DIR}/logs/stdout.log
StandardError=append:${DATA_DIR}/logs/stderr.log
CapabilityBoundingSet=CAP_DAC_READ_SEARCH CAP_DAC_OVERRIDE CAP_CHOWN CAP_FOWNER CAP_SETUID CAP_SETGID
AmbientCapabilities=CAP_DAC_READ_SEARCH
EnvironmentFile=${ENV_FILE}
EnvironmentFile=${ENC_ENV_FILE}
Environment="PLUTON_DATA_DIR=${DATA_DIR}"
Environment="NODE_ENV=production"
Environment="PLUTON_LINUX_DESKTOP=true"

[Install]
WantedBy=multi-user.target
EOF

# Copy uninstall script
echo "  Installing uninstall script..."
cp "${APPDIR}/usr/share/pluton/uninstall.sh" "${INSTALL_DIR}/uninstall.sh"
chmod +x "${INSTALL_DIR}/uninstall.sh"

# Copy icon for desktop shortcut
echo "  Copying icon..."
if [ -f "${APPDIR}/pluton.png" ]; then
    cp "${APPDIR}/pluton.png" "${INSTALL_DIR}/pluton.png"
fi

# Create desktop shortcut for browser access
echo "  Creating desktop shortcut..."
DESKTOP_FILE="/usr/share/applications/pluton.desktop"
cat > "${DESKTOP_FILE}" << EOF
[Desktop Entry]
Name=Pluton
Comment=Open Pluton Backup Dashboard
Exec=xdg-open http://localhost:${SERVER_PORT}
Icon=${INSTALL_DIR}/pluton.png
Type=Application
Categories=Utility;
Terminal=false
StartupNotify=false
EOF

# Update desktop database
update-desktop-database /usr/share/applications 2>/dev/null || true

# Reload systemd and enable service
echo "  Enabling service..."
systemctl daemon-reload
systemctl enable pluton

# Start the service
echo "  Starting service..."
systemctl start pluton

# Wait a moment for the service to start
sleep 2

# Check status
if systemctl is-active --quiet pluton; then
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║         Pluton installed successfully!                    ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${BLUE}Access Pluton at:${NC} http://localhost:${SERVER_PORT}"
    echo ""
    echo -e "  ${BLUE}Service commands:${NC}"
    echo "    sudo systemctl status pluton   - Check status"
    echo "    sudo systemctl stop pluton     - Stop service"
    echo "    sudo systemctl start pluton    - Start service"
    echo "    sudo systemctl restart pluton  - Restart service"
    echo ""
    echo -e "  ${BLUE}Logs:${NC}"
    echo "    ${DATA_DIR}/logs/stdout.log"
    echo "    ${DATA_DIR}/logs/stderr.log"
    echo ""
    echo -e "  ${BLUE}Uninstall:${NC}"
    echo "    sudo ${INSTALL_DIR}/uninstall.sh"
    echo ""
else
    echo ""
    echo -e "${RED}Warning: Service may not have started correctly.${NC}"
    echo "Check status with: sudo systemctl status pluton"
    echo "Check logs with: sudo journalctl -u pluton -f"
fi
