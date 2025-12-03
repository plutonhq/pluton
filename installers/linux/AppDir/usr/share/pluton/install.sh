#!/bin/bash
# Pluton Installation Script
# Installs Pluton as a systemd service running with root privileges

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
SERVICE_FILE="/etc/systemd/system/pluton.service"

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

# Create installation directory
echo "  Creating installation directory: ${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}/binaries"
mkdir -p "${INSTALL_DIR}/node_modules"
mkdir -p "${INSTALL_DIR}/drizzle"

# Create data directory with subdirectories
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

# Write configuration file
echo "  Writing configuration..."
cat > "${DATA_DIR}/config/config.json" << EOF
{
  "SERVER_PORT": ${SERVER_PORT},
  "MAX_CONCURRENT_BACKUPS": ${MAX_CONCURRENT_BACKUPS}
}
EOF

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
User=root
Restart=on-failure
RestartSec=5
StandardOutput=append:${DATA_DIR}/logs/stdout.log
StandardError=append:${DATA_DIR}/logs/stderr.log
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
