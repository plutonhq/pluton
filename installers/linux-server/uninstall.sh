#!/bin/bash
# Pluton Server Remote Uninstallation Script
# Usage: curl -sSL https://dl.usepluton.com/server/scripts/uninstall.sh | sudo bash
#
# For non-interactive uninstall with data removal:
#   curl -sSL https://dl.usepluton.com/server/scripts/uninstall.sh | sudo bash -s -- --remove-data --non-interactive

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
CONFIG_DIR="/etc/pluton"
SERVICE_FILE="/etc/systemd/system/pluton.service"
ENV_FILE="${CONFIG_DIR}/pluton.env"

# CLI argument variables
REMOVE_DATA=false
NON_INTERACTIVE=false

# Print banner
print_banner() {
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║       ${PRODUCT_NAME} Backup Service - Remote Uninstaller          ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Print usage
print_usage() {
    echo "Usage: curl -sSL https://dl.usepluton.com/server/scripts/uninstall.sh | sudo bash -s -- [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --remove-data        Remove all data including backups and database"
    echo "  --non-interactive    Run without prompts"
    echo "  --help               Show this help message"
    echo ""
    echo "Examples:"
    echo "  Interactive uninstall:"
    echo "    curl -sSL https://dl.usepluton.com/server/scripts/uninstall.sh | sudo bash"
    echo ""
    echo "  Remove everything without prompts:"
    echo "    curl -sSL https://dl.usepluton.com/server/scripts/uninstall.sh | sudo bash -s -- --remove-data --non-interactive"
}

# Parse command line arguments
parse_args() {
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
                print_usage
                exit 0
                ;;
            *)
                echo -e "${RED}Error: Unknown option: $1${NC}"
                print_usage
                exit 1
                ;;
        esac
    done
}

# Check for root privileges
check_root() {
    if [ "$EUID" -ne 0 ]; then
        echo -e "${RED}Error: This script must be run as root.${NC}"
        echo "Please run with sudo or as root user."
        exit 1
    fi
}

# Main uninstallation flow
main() {
    parse_args "$@"
    print_banner
    check_root
    
    # Check if Pluton is installed
    if [ ! -f "${SERVICE_FILE}" ] && [ ! -d "${INSTALL_DIR}" ] && [ ! -d "${CONFIG_DIR}" ]; then
        echo -e "${YELLOW}${PRODUCT_NAME} does not appear to be installed.${NC}"
        exit 0
    fi
    
    echo -e "${YELLOW}This will remove ${PRODUCT_NAME} from your system.${NC}"
    echo ""
    
    # Stop and disable service if it exists
    if [ -f "${SERVICE_FILE}" ]; then
        echo "Stopping ${PRODUCT_NAME} service..."
        systemctl stop pluton 2>/dev/null || true
        
        echo "Disabling ${PRODUCT_NAME} service..."
        systemctl disable pluton 2>/dev/null || true
        
        echo "Removing service file..."
        rm -f "${SERVICE_FILE}"
        
        echo "Reloading systemd..."
        systemctl daemon-reload
    fi
    
    # Ask about data removal (unless --remove-data or --non-interactive specified)
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
        printf "Remove all data? [y/N] "
        read -n 1 REPLY < /dev/tty
        echo ""
        
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            REMOVE_DATA=true
        fi
    fi
    
    # Remove installation directory (binaries)
    if [ -d "${INSTALL_DIR}" ]; then
        echo "Removing installation directory: ${INSTALL_DIR}"
        rm -rf "${INSTALL_DIR}"
    fi
    
    # Remove credentials directory
    if [ -d "${CONFIG_DIR}" ]; then
        echo "Removing credentials directory: ${CONFIG_DIR}"
        rm -rf "${CONFIG_DIR}"
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
    echo -e "${GREEN}║         ${PRODUCT_NAME} uninstalled successfully!                  ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    if [ "$REMOVE_DATA" = false ]; then
        echo -e "${BLUE}Note:${NC} Your data has been preserved at: ${DATA_DIR}"
        echo "To completely remove all data, run: sudo rm -rf ${DATA_DIR}"
    fi
    
    echo ""
}

# Run main function
main "$@"
