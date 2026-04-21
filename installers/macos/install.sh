#!/bin/bash
# Pluton macOS Installation Script
# Installs Pluton as a launchd service (LaunchDaemon) running with root privileges
#
# Usage:
#   sudo bash install.sh <tarball-extract-dir>
#
# This script is called by Homebrew cask postflight or can be run manually.
# It expects the extracted tarball directory as the first argument.

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
PLIST_FILE="/Library/LaunchDaemons/com.plutonhq.pluton.plist"
PLIST_LABEL="com.plutonhq.pluton"

# Default configuration
DEFAULT_PORT=5173
DEFAULT_MAX_CONCURRENT=2

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║        Pluton Backup Service - macOS Installer            ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check for root privileges
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Error: This script must be run as root.${NC}"
    echo "Please run: sudo $0 $*"
    exit 1
fi

# Determine source directory (extracted tarball location)
SOURCE_DIR="${1}"
if [ -z "$SOURCE_DIR" ] || [ ! -d "$SOURCE_DIR" ]; then
    echo -e "${RED}Error: Source directory not specified or not found.${NC}"
    echo "Usage: sudo bash install.sh <extracted-tarball-dir>"
    exit 1
fi

# Verify the source has the pluton executable
if [ ! -f "$SOURCE_DIR/pluton" ]; then
    echo -e "${RED}Error: pluton executable not found in ${SOURCE_DIR}${NC}"
    exit 1
fi

# Check for existing installation (upgrade detection)
IS_UPGRADE=false
EXISTING_PORT=$DEFAULT_PORT
EXISTING_MAX_CONCURRENT=$DEFAULT_MAX_CONCURRENT

if launchctl list "$PLIST_LABEL" &>/dev/null || [ -d "$INSTALL_DIR" ]; then
    IS_UPGRADE=true
    echo -e "${YELLOW}Existing Pluton installation detected. Upgrading...${NC}"

    # Read existing config
    if [ -f "${DATA_DIR}/config/config.json" ]; then
        EXISTING_PORT=$(grep -o '"SERVER_PORT":[[:space:]]*[0-9]*' "${DATA_DIR}/config/config.json" 2>/dev/null | grep -o '[0-9]*' || echo "$DEFAULT_PORT")
        EXISTING_MAX_CONCURRENT=$(grep -o '"MAX_CONCURRENT_BACKUPS":[[:space:]]*[0-9]*' "${DATA_DIR}/config/config.json" 2>/dev/null | grep -o '[0-9]*' || echo "$DEFAULT_MAX_CONCURRENT")
        echo -e "  ${BLUE}Preserving existing config (port: ${EXISTING_PORT})${NC}"
    fi

    # Stop existing service
    echo "  Stopping existing service..."
    launchctl bootout system/"$PLIST_LABEL" 2>/dev/null || true
    sleep 2
fi

# Configuration: Only prompt on fresh install
SERVER_PORT=$EXISTING_PORT
MAX_CONCURRENT_BACKUPS=$EXISTING_MAX_CONCURRENT

if [ "$IS_UPGRADE" = false ]; then
    # Check for non-interactive flag
    if [ "$2" = "--non-interactive" ]; then
        SERVER_PORT="${3:-$DEFAULT_PORT}"
        MAX_CONCURRENT_BACKUPS="${4:-$DEFAULT_MAX_CONCURRENT}"
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
fi

echo ""
echo -e "${BLUE}Installing Pluton...${NC}"

# Create installation directory
echo "  Creating installation directory: ${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}/binaries"
mkdir -p "${INSTALL_DIR}/node_modules"
mkdir -p "${INSTALL_DIR}/drizzle"

# Create config and data directories
echo "  Creating config directory: ${CONFIG_DIR}"
mkdir -p "${CONFIG_DIR}"
echo "  Creating data directory: ${DATA_DIR}"
mkdir -p "${DATA_DIR}/config"
mkdir -p "${DATA_DIR}/db"
mkdir -p "${DATA_DIR}/logs"
mkdir -p "${DATA_DIR}/backups"
mkdir -p "${DATA_DIR}/progress"
mkdir -p "${DATA_DIR}/rescue"
mkdir -p "${DATA_DIR}/restore"
mkdir -p "${DATA_DIR}/stats"
mkdir -p "${DATA_DIR}/sync"

# Copy executable
echo "  Copying executable..."
cp "${SOURCE_DIR}/pluton" "${INSTALL_DIR}/pluton"
chmod +x "${INSTALL_DIR}/pluton"

# Copy binaries (restic, rclone)
echo "  Copying binaries..."
if [ -d "${SOURCE_DIR}/binaries" ]; then
    cp -r "${SOURCE_DIR}/binaries"/* "${INSTALL_DIR}/binaries/"
    find "${INSTALL_DIR}/binaries" -type f -exec chmod +x {} \;
fi

# Copy native modules
echo "  Copying native modules..."
if [ -d "${SOURCE_DIR}/node_modules" ]; then
    cp -r "${SOURCE_DIR}/node_modules"/* "${INSTALL_DIR}/node_modules/"
fi

# Copy drizzle migrations
echo "  Copying database migrations..."
if [ -d "${SOURCE_DIR}/drizzle" ]; then
    cp -r "${SOURCE_DIR}/drizzle"/* "${INSTALL_DIR}/drizzle/"
fi

# Copy uninstall script
echo "  Installing uninstall script..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "${SCRIPT_DIR}/uninstall.sh" ]; then
    cp "${SCRIPT_DIR}/uninstall.sh" "${INSTALL_DIR}/uninstall.sh"
    chmod +x "${INSTALL_DIR}/uninstall.sh"
fi

# Copy service wrapper script
echo "  Installing service wrapper..."
if [ -f "${SCRIPT_DIR}/pluton-service.sh" ]; then
    cp "${SCRIPT_DIR}/pluton-service.sh" "${INSTALL_DIR}/pluton-service.sh"
    chmod +x "${INSTALL_DIR}/pluton-service.sh"
fi

# Ensure config directory has restrictive permissions for sensitive env files
echo "  Setting config directory permissions..."
chmod 700 "${CONFIG_DIR}"

# Ensure data directory has restrictive permissions for sensitive files
echo "  Setting data directory permissions..."
chmod 700 "${DATA_DIR}"

# Write configuration file (only on fresh install — preserve on upgrade)
if [ "$IS_UPGRADE" = false ] || [ ! -f "${DATA_DIR}/config/config.json" ]; then
    echo "  Writing configuration..."
    cat > "${DATA_DIR}/config/config.json" << EOF
{
  "SERVER_PORT": ${SERVER_PORT},
  "MAX_CONCURRENT_BACKUPS": ${MAX_CONCURRENT_BACKUPS}
}
EOF
else
    echo "  Preserving existing configuration..."
fi

# Create LaunchDaemon plist
echo "  Creating LaunchDaemon..."
cat > "${PLIST_FILE}" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${INSTALL_DIR}/pluton-service.sh</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${INSTALL_DIR}</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PLUTON_DATA_DIR</key>
        <string>${DATA_DIR}</string>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>

    <key>StandardOutPath</key>
    <string>${DATA_DIR}/logs/stdout.log</string>

    <key>StandardErrorPath</key>
    <string>${DATA_DIR}/logs/stderr.log</string>

    <key>ThrottleInterval</key>
    <integer>5</integer>
</dict>
</plist>
EOF

# Set correct permissions on plist
chmod 644 "${PLIST_FILE}"
chown root:wheel "${PLIST_FILE}"

# Load and start the service
echo "  Starting service..."
launchctl bootstrap system "${PLIST_FILE}"

# Wait a moment for the service to start
sleep 2

# Check status
if launchctl list "$PLIST_LABEL" &>/dev/null; then
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    if [ "$IS_UPGRADE" = true ]; then
        echo -e "${GREEN}║         Pluton upgraded successfully!                    ║${NC}"
    else
        echo -e "${GREEN}║         Pluton installed successfully!                   ║${NC}"
    fi
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${BLUE}Access Pluton at:${NC} http://localhost:${SERVER_PORT}"
    echo ""
    echo -e "  ${BLUE}Service commands:${NC}"
    echo "    sudo launchctl kickstart -k system/${PLIST_LABEL}  - Restart"
    echo "    sudo launchctl bootout system/${PLIST_LABEL}       - Stop"
    echo "    sudo launchctl bootstrap system ${PLIST_FILE}      - Start"
    echo ""
    echo -e "  ${BLUE}Logs:${NC}"
    echo "    ${DATA_DIR}/logs/stdout.log"
    echo "    ${DATA_DIR}/logs/stderr.log"
    echo ""
    echo -e "  ${BLUE}Uninstall:${NC}"
    echo "    sudo ${INSTALL_DIR}/uninstall.sh"
    echo ""

    # macOS Full Disk Access notice
    echo -e "  ${YELLOW}⚠️  Important: Full Disk Access${NC}"
    echo "    To back up files in protected directories (Desktop, Documents, etc.),"
    echo "    grant Full Disk Access to the Pluton binary:"
    echo "      System Settings → Privacy & Security → Full Disk Access"
    echo "      Add: ${INSTALL_DIR}/pluton"
    echo ""
else
    echo ""
    echo -e "${RED}Warning: Service may not have started correctly.${NC}"
    echo "Check status with: sudo launchctl list ${PLIST_LABEL}"
    echo "Check logs at: ${DATA_DIR}/logs/"
fi
