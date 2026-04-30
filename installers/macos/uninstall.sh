#!/bin/bash
# Pluton macOS Uninstallation Script
# Removes Pluton service and optionally all data
#
# Usage:
#   sudo bash uninstall.sh [--remove-data] [--non-interactive]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Product name
PRODUCT_NAME="Pluton"

# Installation paths
INSTALL_DIR="/opt/pluton"
DATA_DIR="/var/lib/pluton"
PLIST_FILE="/Library/LaunchDaemons/com.plutonhq.pluton.plist"
PLIST_LABEL="com.plutonhq.pluton"

# CLI argument variables
REMOVE_DATA=false
NON_INTERACTIVE=false

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║       ${PRODUCT_NAME} Backup Service - macOS Uninstaller           ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --remove-data)
            REMOVE_DATA=true
            shift
            ;;
        --non-interactive)
            NON_INTERACTIVE=true
            shift
            ;;
        --help)
            echo "Usage: sudo bash uninstall.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --remove-data        Remove all data including backups and database"
            echo "  --non-interactive    Run without prompts"
            echo "  --help               Show this help message"
            exit 0
            ;;
        *)
            echo -e "${RED}Error: Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Check for root privileges
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Error: This script must be run as root.${NC}"
    echo "Please run: sudo $0"
    exit 1
fi

# Check if Pluton is installed
if [ ! -f "${PLIST_FILE}" ] && [ ! -d "${INSTALL_DIR}" ]; then
    echo -e "${YELLOW}${PRODUCT_NAME} does not appear to be installed.${NC}"
    exit 0
fi

echo -e "${YELLOW}This will remove ${PRODUCT_NAME} from your system.${NC}"
echo ""

# Stop and unload LaunchDaemon if it exists
if [ -f "${PLIST_FILE}" ]; then
    echo "Stopping ${PRODUCT_NAME} service..."
    launchctl bootout system/"$PLIST_LABEL" 2>/dev/null || true
    sleep 2

    echo "Removing LaunchDaemon plist..."
    rm -f "${PLIST_FILE}"
fi

# Ask about data removal (unless flags specified)
if [ "$NON_INTERACTIVE" = false ] && [ "$REMOVE_DATA" = false ]; then
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

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        REMOVE_DATA=true
    fi
fi

# Remove installation directory
if [ -d "${INSTALL_DIR}" ]; then
    echo "Removing installation directory: ${INSTALL_DIR}"
    rm -rf "${INSTALL_DIR}"
fi

# Clean up Pluton keychain (created for LaunchDaemon keyring access)
KEYCHAIN_PATH="/var/root/Library/Keychains/pluton.keychain-db"
if security show-keychain-info "${KEYCHAIN_PATH}" &>/dev/null; then
    echo "Removing Pluton system keychain..."
    security delete-keychain "${KEYCHAIN_PATH}" 2>/dev/null || true
fi

# Remove credentials directory only when --remove-data is set. Preserving
# /etc/pluton keeps the encryption key and admin credentials available so
# that a future Pluton or Pluton PRO install can pick them up automatically.
CONFIG_DIR="/etc/pluton"

# Remove data + credentials if requested
if [ "$REMOVE_DATA" = true ]; then
    if [ -d "${CONFIG_DIR}" ]; then
        echo "Removing credentials directory: ${CONFIG_DIR}"
        rm -rf "${CONFIG_DIR}"
    fi
    if [ -d "${DATA_DIR}" ]; then
        echo "Removing data directory: ${DATA_DIR}"
        rm -rf "${DATA_DIR}"
    fi
else
    [ -d "${CONFIG_DIR}" ] && echo -e "${BLUE}Keeping credentials directory: ${CONFIG_DIR}${NC}"
    echo -e "${BLUE}Keeping data directory: ${DATA_DIR}${NC}"
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         ${PRODUCT_NAME} uninstalled successfully!                  ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

if [ "$REMOVE_DATA" = false ]; then
    echo -e "${BLUE}Note:${NC} Your data has been preserved at: ${DATA_DIR}"
    echo "To completely remove all data, run: sudo rm -rf ${DATA_DIR}"
fi

echo ""
