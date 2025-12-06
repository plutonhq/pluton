#!/bin/bash
# Pluton Server Remote Installation Script
# Downloads and installs Pluton from the official CDN
# Usage: curl -sSL https://dl.usepluton.com/server/scripts/install.sh | sudo bash
#
# For non-interactive install:
#   curl -sSL https://dl.usepluton.com/server/scripts/install.sh | sudo bash -s -- \
#       --port 5173 --encryption-key "key" --user admin --password "pass" --non-interactive

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[38;2;5;109;255m'
NC='\033[0m' # No Color

# Product name
PRODUCT_NAME="Pluton"

# CDN base URL
CDN_BASE_URL="https://dl.usepluton.com/server"

# Installation paths
INSTALL_DIR="/opt/pluton"
DATA_DIR="/var/lib/pluton"
CONFIG_DIR="/etc/pluton"
SERVICE_FILE="/etc/systemd/system/pluton.service"
ENV_FILE="${CONFIG_DIR}/pluton.env"

# Temp directory for downloads
TMP_DIR=$(mktemp -d)
trap "rm -rf ${TMP_DIR}" EXIT

# Default configuration
DEFAULT_PORT=5173
DEFAULT_MAX_CONCURRENT=2

# CLI argument variables
CLI_PORT=""
CLI_MAX_CONCURRENT=""
CLI_ENCRYPTION_KEY=""
CLI_USER_NAME=""
CLI_USER_PASSWORD=""
CLI_CONFIG_FILE=""
CLI_UPGRADE=false
CLI_NON_INTERACTIVE=false
CLI_VERSION="latest"

# Print banner
print_banner() {
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║      ☄️ ${PRODUCT_NAME} Backup Service - Remote Installer ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Print usage
print_usage() {
    echo "Usage: curl -sSL https://dl.usepluton.com/server/scripts/install.sh | sudo bash -s -- [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --port <port>              Server port (default: 5173)"
    echo "  --max-concurrent <num>     Max concurrent backups (default: 2)"
    echo "  --encryption-key <key>     Encryption key for backups (min 12 chars)"
    echo "  --user <username>          Admin username"
    echo "  --password <password>      Admin password"
    echo "  --config <file>            Path to .env config file"
    echo "  --upgrade                  Upgrade existing installation (preserve data)"
    echo "  --non-interactive          Run without prompts (requires all credentials)"
    echo "  --version <version>        Specific version to install (default: latest)"
    echo "  --help                     Show this help message"
    echo ""
    echo "Examples:"
    echo "  Interactive install:"
    echo "    curl -sSL https://dl.usepluton.com/server/scripts/install.sh | sudo bash"
    echo ""
    echo "  Non-interactive install:"
    echo "    curl -sSL https://dl.usepluton.com/server/scripts/install.sh | sudo bash -s -- \\"
    echo "        --port 5173 --encryption-key 'mysecretkey123' \\"
    echo "        --user admin --password 'mypassword' --non-interactive"
    echo ""
    echo "  Upgrade existing installation:"
    echo "    curl -sSL https://dl.usepluton.com/server/scripts/install.sh | sudo bash -s -- --upgrade"
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --port)
                CLI_PORT="$2"
                shift 2
                ;;
            --max-concurrent)
                CLI_MAX_CONCURRENT="$2"
                shift 2
                ;;
            --encryption-key)
                CLI_ENCRYPTION_KEY="$2"
                shift 2
                ;;
            --user)
                CLI_USER_NAME="$2"
                shift 2
                ;;
            --password)
                CLI_USER_PASSWORD="$2"
                shift 2
                ;;
            --config)
                CLI_CONFIG_FILE="$2"
                shift 2
                ;;
            --upgrade)
                CLI_UPGRADE=true
                shift
                ;;
            --non-interactive)
                CLI_NON_INTERACTIVE=true
                shift
                ;;
            --version)
                CLI_VERSION="$2"
                shift 2
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

# Check for required commands
check_dependencies() {
    local missing=()
    
    for cmd in curl tar; do
        if ! command -v $cmd &> /dev/null; then
            missing+=($cmd)
        fi
    done
    
    if [ ${#missing[@]} -gt 0 ]; then
        echo -e "${RED}Error: Missing required commands: ${missing[*]}${NC}"
        echo "Please install them and try again."
        exit 1
    fi
}

# Detect system architecture
detect_architecture() {
    local arch=$(uname -m)
    case $arch in
        x86_64|amd64)
            echo "x64"
            ;;
        aarch64|arm64)
            echo "arm64"
            ;;
        *)
            echo -e "${RED}Error: Unsupported architecture: $arch${NC}"
            echo "${PRODUCT_NAME} supports x86_64 (amd64) and aarch64 (arm64) architectures."
            exit 1
            ;;
    esac
}

# Check for root privileges
check_root() {
    if [ "$EUID" -ne 0 ]; then
        echo -e "${RED}Error: This script must be run as root.${NC}"
        echo "Please run with sudo or as root user."
        exit 1
    fi
}

# Check if this is an upgrade
check_existing_installation() {
    if systemctl is-active --quiet pluton 2>/dev/null || [ -f "${ENV_FILE}" ]; then
        return 0  # Existing installation found
    fi
    return 1  # No existing installation
}

# Load config from file
load_config_file() {
    local config_file="$1"
    
    if [ ! -f "$config_file" ]; then
        echo -e "${RED}Error: Config file not found: $config_file${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}Loading configuration from: ${config_file}${NC}"
    
    set -a
    source "$config_file"
    set +a
    
    [ -n "${PLUTON_ENCRYPTION_KEY:-}" ] && CLI_ENCRYPTION_KEY="$PLUTON_ENCRYPTION_KEY"
    [ -n "${PLUTON_USER_NAME:-}" ] && CLI_USER_NAME="$PLUTON_USER_NAME"
    [ -n "${PLUTON_USER_PASSWORD:-}" ] && CLI_USER_PASSWORD="$PLUTON_USER_PASSWORD"
    [ -n "${SERVER_PORT:-}" ] && CLI_PORT="$SERVER_PORT"
    [ -n "${MAX_CONCURRENT_BACKUPS:-}" ] && CLI_MAX_CONCURRENT="$MAX_CONCURRENT_BACKUPS"
}

# Load existing credentials (for upgrade)
load_existing_credentials() {
    if [ -f "${ENV_FILE}" ]; then
        echo -e "${GREEN}Loading existing credentials from: ${ENV_FILE}${NC}"
        set -a
        source "${ENV_FILE}"
        set +a
        
        [ -n "${PLUTON_ENCRYPTION_KEY:-}" ] && CLI_ENCRYPTION_KEY="$PLUTON_ENCRYPTION_KEY"
        [ -n "${PLUTON_USER_NAME:-}" ] && CLI_USER_NAME="$PLUTON_USER_NAME"
        [ -n "${PLUTON_USER_PASSWORD:-}" ] && CLI_USER_PASSWORD="$PLUTON_USER_PASSWORD"
    fi
    
    if [ -f "${DATA_DIR}/config/config.json" ]; then
        local port=$(grep -o '"SERVER_PORT"[[:space:]]*:[[:space:]]*[0-9]*' "${DATA_DIR}/config/config.json" 2>/dev/null | grep -o '[0-9]*' || echo "")
        local max_concurrent=$(grep -o '"MAX_CONCURRENT_BACKUPS"[[:space:]]*:[[:space:]]*[0-9]*' "${DATA_DIR}/config/config.json" 2>/dev/null | grep -o '[0-9]*' || echo "")
        
        [ -n "$port" ] && CLI_PORT="$port"
        [ -n "$max_concurrent" ] && CLI_MAX_CONCURRENT="$max_concurrent"
    fi
}

# Prompt for configuration (interactive mode)
# Note: We read from /dev/tty to support curl | bash usage
prompt_configuration() {
    echo -e "${BLUE}Configuration Setup${NC}"
    echo "Press Enter to accept default values."
    echo ""
    
    local default_port="${CLI_PORT:-$DEFAULT_PORT}"
    printf "Server Port [${default_port}]: "
    read input_port < /dev/tty
    CLI_PORT="${input_port:-$default_port}"
    
    if ! [[ "$CLI_PORT" =~ ^[0-9]+$ ]] || [ "$CLI_PORT" -lt 1024 ] || [ "$CLI_PORT" -gt 65535 ]; then
        echo -e "${RED}Error: Invalid port. Must be between 1024 and 65535.${NC}"
        exit 1
    fi
    
    local default_max="${CLI_MAX_CONCURRENT:-$DEFAULT_MAX_CONCURRENT}"
    printf "Max Concurrent Backups [${default_max}]: "
    read input_max < /dev/tty
    CLI_MAX_CONCURRENT="${input_max:-$default_max}"
    
    if ! [[ "$CLI_MAX_CONCURRENT" =~ ^[0-9]+$ ]] || [ "$CLI_MAX_CONCURRENT" -lt 1 ] || [ "$CLI_MAX_CONCURRENT" -gt 10 ]; then
        echo -e "${RED}Error: Invalid value. Must be between 1 and 10.${NC}"
        exit 1
    fi
}

# Prompt for credentials (interactive mode)
# Note: We read from /dev/tty to support curl | bash usage
prompt_credentials() {
    echo ""
    echo -e "${BLUE}Security Credentials${NC}"
    echo "These credentials are required for ${PRODUCT_NAME} to function."
    echo ""
    
    while [ -z "$CLI_ENCRYPTION_KEY" ] || [ ${#CLI_ENCRYPTION_KEY} -lt 12 ]; do
        printf "Encryption Key (min 12 characters): "
        read CLI_ENCRYPTION_KEY < /dev/tty
        if [ ${#CLI_ENCRYPTION_KEY} -lt 12 ]; then
            echo -e "${RED}Error: Encryption key must be at least 12 characters.${NC}"
            CLI_ENCRYPTION_KEY=""
        fi
    done
    
    while [ -z "$CLI_USER_NAME" ]; do
        printf "Admin Username: "
        read CLI_USER_NAME < /dev/tty
        if [ -z "$CLI_USER_NAME" ]; then
            echo -e "${RED}Error: Username is required.${NC}"
        fi
    done
    
    while true; do
        printf "Admin Password (min 6 characters): "
        # Disable echo for password input, operating on /dev/tty
        stty -echo < /dev/tty
        read CLI_USER_PASSWORD < /dev/tty
        stty echo < /dev/tty
        echo ""
        
        if [ -z "$CLI_USER_PASSWORD" ]; then
            echo -e "${RED}Error: Password is required.${NC}"
            continue
        fi
        
        if [ ${#CLI_USER_PASSWORD} -lt 6 ]; then
            echo -e "${RED}Error: Password must be at least 6 characters.${NC}"
            CLI_USER_PASSWORD=""
            continue
        fi
        
        printf "Confirm Admin Password: "
        stty -echo < /dev/tty
        read CLI_USER_PASSWORD_CONFIRM < /dev/tty
        stty echo < /dev/tty
        echo ""
        
        if [ "$CLI_USER_PASSWORD" != "$CLI_USER_PASSWORD_CONFIRM" ]; then
            echo -e "${RED}Error: Passwords do not match. Please try again.${NC}"
            CLI_USER_PASSWORD=""
            continue
        fi
        
        break
    done
}

# Validate all required values are set
validate_configuration() {
    local errors=0
    
    if [ -z "$CLI_ENCRYPTION_KEY" ] || [ ${#CLI_ENCRYPTION_KEY} -lt 12 ]; then
        echo -e "${RED}Error: Encryption key is required (min 12 characters).${NC}"
        errors=$((errors + 1))
    fi
    
    if [ -z "$CLI_USER_NAME" ]; then
        echo -e "${RED}Error: Username is required.${NC}"
        errors=$((errors + 1))
    fi
    
    if [ -z "$CLI_USER_PASSWORD" ]; then
        echo -e "${RED}Error: Password is required.${NC}"
        errors=$((errors + 1))
    elif [ ${#CLI_USER_PASSWORD} -lt 6 ]; then
        echo -e "${RED}Error: Password must be at least 6 characters.${NC}"
        errors=$((errors + 1))
    fi
    
    if [ $errors -gt 0 ]; then
        echo ""
        echo "Use --help for usage information."
        exit 1
    fi
    
    CLI_PORT="${CLI_PORT:-$DEFAULT_PORT}"
    CLI_MAX_CONCURRENT="${CLI_MAX_CONCURRENT:-$DEFAULT_MAX_CONCURRENT}"
}

# Stop existing service
stop_existing_service() {
    if systemctl is-active --quiet pluton 2>/dev/null; then
        echo "Stopping existing ${PRODUCT_NAME} service..."
        systemctl stop pluton
    fi
}

# Download and extract files
download_files() {
    local arch="$1"
    local version="$2"
    local download_url="${CDN_BASE_URL}/releases/${version}/pluton-linux-${arch}.tar.gz"
    local archive_path="${TMP_DIR}/pluton-linux-${arch}.tar.gz"
    
    echo -e "${BLUE}Downloading ${PRODUCT_NAME} (${arch}, ${version})...${NC}"
    echo "  URL: ${download_url}"
    
    # Download with progress
    if ! curl -fSL --progress-bar -o "${archive_path}" "${download_url}"; then
        echo -e "${RED}Error: Failed to download from ${download_url}${NC}"
        echo ""
        echo "Please check:"
        echo "  - Your internet connection"
        echo "  - The version exists: ${version}"
        echo "  - The architecture is supported: ${arch}"
        exit 1
    fi
    
    echo "  Extracting..."
    tar -xzf "${archive_path}" -C "${TMP_DIR}"
    
    # The archive should extract to pluton-linux-{arch}/
    if [ ! -d "${TMP_DIR}/pluton-linux-${arch}" ]; then
        # Try without architecture suffix (in case archive extracts to pluton/)
        if [ -d "${TMP_DIR}/pluton" ]; then
            mv "${TMP_DIR}/pluton" "${TMP_DIR}/pluton-linux-${arch}"
        else
            echo -e "${RED}Error: Unexpected archive structure${NC}"
            exit 1
        fi
    fi
    
    echo -e "  ${GREEN}✓${NC} Download complete"
}

# Install files
install_files() {
    local arch="$1"
    local source_dir="${TMP_DIR}/pluton-linux-${arch}"
    
    echo -e "${BLUE}Installing ${PRODUCT_NAME}...${NC}"
    
    # Create directories
    echo "  Creating installation directory: ${INSTALL_DIR}"
    mkdir -p "${INSTALL_DIR}"
    mkdir -p "${INSTALL_DIR}/binaries"
    mkdir -p "${INSTALL_DIR}/node_modules"
    mkdir -p "${INSTALL_DIR}/drizzle"
    
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
    
    echo "  Creating config directory: ${CONFIG_DIR}"
    mkdir -p "${CONFIG_DIR}"
    chmod 700 "${CONFIG_DIR}"
    
    # Copy executable
    echo "  Copying executable..."
    cp "${source_dir}/pluton" "${INSTALL_DIR}/pluton"
    chmod +x "${INSTALL_DIR}/pluton"
    
    # Copy binaries
    echo "  Copying binaries..."
    if [ -d "${source_dir}/binaries" ]; then
        cp -r "${source_dir}/binaries"/* "${INSTALL_DIR}/binaries/"
        find "${INSTALL_DIR}/binaries" -type f -exec chmod +x {} \;
    fi
    
    # Copy native modules
    echo "  Copying native modules..."
    if [ -d "${source_dir}/node_modules" ]; then
        cp -r "${source_dir}/node_modules"/* "${INSTALL_DIR}/node_modules/"
    fi
    
    # Copy drizzle migrations
    echo "  Copying database migrations..."
    if [ -d "${source_dir}/drizzle" ]; then
        cp -r "${source_dir}/drizzle"/* "${INSTALL_DIR}/drizzle/"
    fi
    
    # Copy documentation
    [ -f "${source_dir}/LICENSE" ] && cp "${source_dir}/LICENSE" "${INSTALL_DIR}/"
    [ -f "${source_dir}/README.md" ] && cp "${source_dir}/README.md" "${INSTALL_DIR}/"
}

# Write configuration files
write_configuration() {
    echo "  Writing credentials to ${ENV_FILE}..."
    cat > "${ENV_FILE}" << EOF
# ${PRODUCT_NAME} Server Credentials
# Generated by installer on $(date)
# WARNING: This file contains sensitive credentials. Keep it secure.

PLUTON_ENCRYPTION_KEY=${CLI_ENCRYPTION_KEY}
PLUTON_USER_NAME=${CLI_USER_NAME}
PLUTON_USER_PASSWORD=${CLI_USER_PASSWORD}
EOF
    chmod 600 "${ENV_FILE}"
    
    local config_json="${DATA_DIR}/config/config.json"
    if [ ! -f "$config_json" ] || [ "$CLI_UPGRADE" = false ]; then
        echo "  Writing configuration to ${config_json}..."
        cat > "${config_json}" << EOF
{
  "SERVER_PORT": ${CLI_PORT},
  "MAX_CONCURRENT_BACKUPS": ${CLI_MAX_CONCURRENT}
}
EOF
    else
        echo "  Preserving existing configuration at ${config_json}"
    fi
}

# Install systemd service
install_service() {
    echo "  Creating systemd service..."
    
    cat > "${SERVICE_FILE}" << EOF
[Unit]
Description=${PRODUCT_NAME} Backup Service
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

# Load sensitive credentials from environment file
EnvironmentFile=${ENV_FILE}

# Non-sensitive environment variables
Environment="PLUTON_DATA_DIR=${DATA_DIR}"
Environment="NODE_ENV=production"

[Install]
WantedBy=multi-user.target
EOF
    
    # Download and install uninstall script
    echo "  Installing uninstall script..."
    curl -fsSL -o "${INSTALL_DIR}/uninstall.sh" "${CDN_BASE_URL}/scripts/uninstall.sh" 2>/dev/null || \
    cat > "${INSTALL_DIR}/uninstall.sh" << 'UNINSTALL_EOF'
#!/bin/bash
# Pluton Server Uninstallation Script
set -e
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

INSTALL_DIR="/opt/pluton"
DATA_DIR="/var/lib/pluton"
CONFIG_DIR="/etc/pluton"
SERVICE_FILE="/etc/systemd/system/pluton.service"

REMOVE_DATA=false
NON_INTERACTIVE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --remove-data) REMOVE_DATA=true; shift ;;
        --non-interactive) NON_INTERACTIVE=true; shift ;;
        --help) echo "Usage: $0 [--remove-data] [--non-interactive]"; exit 0 ;;
        *) shift ;;
    esac
done

if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Error: This script must be run as root.${NC}"
    exit 1
fi

echo -e "${BLUE}Uninstalling Pluton...${NC}"

if [ -f "${SERVICE_FILE}" ]; then
    systemctl stop pluton 2>/dev/null || true
    systemctl disable pluton 2>/dev/null || true
    rm -f "${SERVICE_FILE}"
    systemctl daemon-reload
fi

if [ "$NON_INTERACTIVE" = false ] && [ "$REMOVE_DATA" = false ]; then
    printf "Remove all data (database, logs, backups)? [y/N] "
    read -n 1 REPLY < /dev/tty
    echo
    [[ $REPLY =~ ^[Yy]$ ]] && REMOVE_DATA=true
fi

rm -rf "${INSTALL_DIR}"
rm -rf "${CONFIG_DIR}"
[ "$REMOVE_DATA" = true ] && rm -rf "${DATA_DIR}"

echo -e "${GREEN}Pluton uninstalled successfully!${NC}"
[ "$REMOVE_DATA" = false ] && echo "Data preserved at: ${DATA_DIR}"
UNINSTALL_EOF
    chmod +x "${INSTALL_DIR}/uninstall.sh"
    
    echo "  Enabling service..."
    systemctl daemon-reload
    systemctl enable pluton
}

# Start service and verify
start_service() {
    echo "  Starting service..."
    systemctl start pluton
    sleep 3
    
    if systemctl is-active --quiet pluton; then
        return 0
    else
        return 1
    fi
}

# Print success message
print_success() {
    local install_type="$1"
    
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    if [ "$install_type" = "upgrade" ]; then
        echo -e "${GREEN}║         ${PRODUCT_NAME} upgraded successfully!                     ║${NC}"
    else
        echo -e "${GREEN}║         ${PRODUCT_NAME} installed successfully!                    ║${NC}"
    fi
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${BLUE}Access ${PRODUCT_NAME} at:${NC} http://localhost:${CLI_PORT}"
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
    echo "    sudo journalctl -u pluton -f"
    echo ""
    echo -e "  ${BLUE}Uninstall:${NC}"
    echo "    sudo ${INSTALL_DIR}/uninstall.sh"
    echo ""
}

# Print failure message
print_failure() {
    echo ""
    echo -e "${RED}Warning: Service may not have started correctly.${NC}"
    echo "Check status with: sudo systemctl status pluton"
    echo "Check logs with: sudo journalctl -u pluton -f"
}

# Main installation flow
main() {
    parse_args "$@"
    print_banner
    check_root
    check_dependencies
    
    local arch=$(detect_architecture)
    echo -e "Detected architecture: ${GREEN}${arch}${NC}"
    echo ""
    
    local is_upgrade=false
    if check_existing_installation; then
        if [ "$CLI_UPGRADE" = true ]; then
            is_upgrade=true
            echo -e "${YELLOW}Upgrade mode: Preserving existing configuration and data.${NC}"
            load_existing_credentials
        else
            echo -e "${YELLOW}${PRODUCT_NAME} is already installed.${NC}"
            if [ "$CLI_NON_INTERACTIVE" = true ]; then
                echo "Use --upgrade flag to upgrade existing installation."
                exit 1
            fi
            printf "Do you want to reinstall? This will stop the current service. [y/N] "
            read -n 1 REPLY < /dev/tty
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                echo "Installation cancelled."
                exit 0
            fi
        fi
        stop_existing_service
    fi
    
    if [ -n "$CLI_CONFIG_FILE" ]; then
        load_config_file "$CLI_CONFIG_FILE"
    fi
    
    if [ "$CLI_NON_INTERACTIVE" = true ]; then
        validate_configuration
    else
        if [ "$is_upgrade" = false ]; then
            prompt_configuration
            if [ -z "$CLI_ENCRYPTION_KEY" ] || [ -z "$CLI_USER_NAME" ] || [ -z "$CLI_USER_PASSWORD" ]; then
                prompt_credentials
            fi
        else
            if [ -z "$CLI_ENCRYPTION_KEY" ] || [ -z "$CLI_USER_NAME" ] || [ -z "$CLI_USER_PASSWORD" ]; then
                echo -e "${YELLOW}Existing credentials not found. Please enter new credentials:${NC}"
                prompt_credentials
            fi
        fi
        validate_configuration
    fi
    
    echo ""
    
    download_files "$arch" "$CLI_VERSION"
    install_files "$arch"
    write_configuration
    install_service
    
    if start_service; then
        if [ "$is_upgrade" = true ]; then
            print_success "upgrade"
        else
            print_success "install"
        fi
    else
        print_failure
    fi
}

main "$@"
