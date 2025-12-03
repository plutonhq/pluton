#!/bin/bash
# Pluton Uninstallation Script
# Removes Pluton service and optionally all data

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
DESKTOP_FILE="/usr/share/applications/pluton.desktop"
ICON_FILE="/usr/share/icons/hicolor/256x256/apps/pluton.png"

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║          Pluton Backup Service - Uninstaller              ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check for root privileges
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Error: This script must be run as root.${NC}"
    echo "Please run: sudo $0"
    exit 1
fi

# Check if Pluton is installed
if [ ! -f "${SERVICE_FILE}" ] && [ ! -d "${INSTALL_DIR}" ]; then
    echo -e "${YELLOW}Pluton does not appear to be installed.${NC}"
    exit 0
fi

echo -e "${YELLOW}This will remove Pluton from your system.${NC}"
echo ""

# Stop and disable service if it exists
if [ -f "${SERVICE_FILE}" ]; then
    echo "Stopping Pluton service..."
    systemctl stop pluton 2>/dev/null || true
    
    echo "Disabling Pluton service..."
    systemctl disable pluton 2>/dev/null || true
    
    echo "Removing service file..."
    rm -f "${SERVICE_FILE}"
    
    echo "Reloading systemd..."
    systemctl daemon-reload
fi

# Ask about data removal
echo ""
echo -e "${YELLOW}Do you want to remove all configuration and backup data?${NC}"
echo "  Data directory: ${DATA_DIR}"
echo ""
echo "  This includes:"
echo "    - Configuration files"
echo "    - Database"
echo "    - Logs"
echo "    - Local backup copies"
echo ""
read -p "Remove all data? [y/N] " -n 1 -r
echo ""

REMOVE_DATA=false
if [[ $REPLY =~ ^[Yy]$ ]]; then
    REMOVE_DATA=true
fi

# Remove installation directory
if [ -d "${INSTALL_DIR}" ]; then
    echo "Removing installation directory: ${INSTALL_DIR}"
    rm -rf "${INSTALL_DIR}"
fi

# Remove desktop shortcut and icon
if [ -f "${DESKTOP_FILE}" ]; then
    echo "Removing desktop shortcut..."
    rm -f "${DESKTOP_FILE}"
fi

if [ -f "${ICON_FILE}" ]; then
    echo "Removing application icon..."
    rm -f "${ICON_FILE}"
fi

# Update desktop database
if command -v update-desktop-database &> /dev/null; then
    update-desktop-database /usr/share/applications 2>/dev/null || true
fi

# Remove data directory if requested
if [ "$REMOVE_DATA" = true ]; then
    if [ -d "${DATA_DIR}" ]; then
        echo "Removing data directory: ${DATA_DIR}"
        rm -rf "${DATA_DIR}"
    fi
else
    echo -e "${BLUE}Keeping data directory: ${DATA_DIR}${NC}"
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         Pluton uninstalled successfully!                  ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

if [ "$REMOVE_DATA" = false ]; then
    echo -e "${BLUE}Note:${NC} Your data has been preserved at: ${DATA_DIR}"
    echo "To completely remove all data, run: sudo rm -rf ${DATA_DIR}"
fi

echo ""
