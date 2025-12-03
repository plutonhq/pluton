#!/bin/bash
# Build script for Pluton AppImage
# Run this script in WSL on Windows (access project via /mnt/c/ or /mnt/f/)
#
# Usage:
#   ./build-appimage.sh                        # Build for all available architectures
#   ./build-appimage.sh all                    # Build for all available architectures
#   ./build-appimage.sh x64                    # Build for x86_64 only
#   ./build-appimage.sh arm64                  # Build for ARM64 only
#   ./build-appimage.sh x64 pluton-pro         # Build x86_64 with custom name
#   ./build-appimage.sh all pluton-pro         # Build all with custom name (for PRO edition)
#
# From Windows, run in WSL:
#   wsl -e bash -c "cd /mnt/f/JS/apps/pluton/codebase/pluton-app/pluton/installers/linux && ./build-appimage.sh"

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[1;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
APPDIR="${SCRIPT_DIR}/AppDir"

# Get version from package.json
VERSION=$(grep -o '"version": *"[^"]*"' "${ROOT_DIR}/backend/package.json" | head -1 | cut -d'"' -f4)
if [ -z "$VERSION" ]; then
    VERSION="0.0.0"
fi

# Output name (default: Pluton, can be overridden for PRO edition)
# Passed as second argument: ./build-appimage.sh x64 pluton-pro
OUTPUT_NAME="${2:-Pluton}"
# Capitalize first letter for display name
DISPLAY_NAME="$(echo "$OUTPUT_NAME" | sed 's/.*/\u&/')"

# Output directory
OUTPUT_DIR="${ROOT_DIR}/dist/installers"
mkdir -p "$OUTPUT_DIR"

# Track built architectures
BUILT_ARCHS=()
FAILED_ARCHS=()

#######################################
# Build AppImage for a specific architecture
# Arguments:
#   $1 - Architecture (x64 or arm64)
#######################################
build_appimage() {
    local INPUT_ARCH="$1"
    local ARCH
    local PLATFORM_ID
    local APPIMAGETOOL_ARCH

    case "$INPUT_ARCH" in
        x64|x86_64|amd64)
            ARCH="x86_64"
            PLATFORM_ID="linux-x64"
            APPIMAGETOOL_ARCH="x86_64"
            ;;
        arm64|aarch64)
            ARCH="aarch64"
            PLATFORM_ID="linux-arm64"
            APPIMAGETOOL_ARCH="x86_64"  # Use x86_64 appimagetool with --appimage-extract-and-run
            ;;
        *)
            echo -e "${RED}Error: Unsupported architecture: ${INPUT_ARCH}${NC}"
            return 1
            ;;
    esac

    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  Building for: ${ARCH} (${PLATFORM_ID})${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    # Check for distribution files (try both locations)
    # For PRO edition, look for pluton-pro-linux-x64, for regular look for pluton-linux-x64
    local DIST_NAME="$(echo "$OUTPUT_NAME" | tr '[:upper:]' '[:lower:]')"
    local DIST_DIR="${ROOT_DIR}/dist/executables/${DIST_NAME}-${PLATFORM_ID}"
    if [ ! -d "$DIST_DIR" ]; then
        # Fallback to old location
        DIST_DIR="${ROOT_DIR}/dist/${DIST_NAME}-${PLATFORM_ID}"
    fi
    if [ ! -d "$DIST_DIR" ]; then
        echo -e "${YELLOW}Skipping ${ARCH}: Distribution directory not found${NC}"
        echo -e "${YELLOW}  Checked: ${ROOT_DIR}/dist/executables/${DIST_NAME}-${PLATFORM_ID}${NC}"
        echo -e "${YELLOW}  Checked: ${ROOT_DIR}/dist/${DIST_NAME}-${PLATFORM_ID}${NC}"
        echo -e "${YELLOW}  Run 'node scripts/build-executables.js --name ${DIST_NAME}' first.${NC}"
        FAILED_ARCHS+=("$ARCH (no dist)")
        return 0
    fi

    # Download appimagetool if not present (always use x86_64 version)
    local APPIMAGETOOL="${SCRIPT_DIR}/appimagetool-${APPIMAGETOOL_ARCH}.AppImage"
    if [ ! -f "$APPIMAGETOOL" ]; then
        echo -e "${BLUE}Downloading appimagetool...${NC}"
        local APPIMAGETOOL_URL="https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-${APPIMAGETOOL_ARCH}.AppImage"
        curl -L -o "$APPIMAGETOOL" "$APPIMAGETOOL_URL"
        chmod +x "$APPIMAGETOOL"
    fi

    # Clean and prepare AppDir
    echo "  Preparing AppDir..."
    rm -rf "${APPDIR}/usr/bin/pluton"
    rm -rf "${APPDIR}/usr/bin/binaries"
    rm -rf "${APPDIR}/usr/bin/node_modules"
    rm -rf "${APPDIR}/usr/bin/drizzle"

    mkdir -p "${APPDIR}/usr/bin"
    mkdir -p "${APPDIR}/usr/bin/binaries/${PLATFORM_ID}"
    mkdir -p "${APPDIR}/usr/bin/node_modules"
    mkdir -p "${APPDIR}/usr/bin/drizzle"

    # Copy main executable
    echo "  Copying executable..."
    cp "${DIST_DIR}/pluton" "${APPDIR}/usr/bin/pluton"
    chmod +x "${APPDIR}/usr/bin/pluton"

    # Copy binaries (restic, rclone)
    echo "  Copying binaries..."
    if [ -d "${DIST_DIR}/binaries/${PLATFORM_ID}" ]; then
        cp -r "${DIST_DIR}/binaries/${PLATFORM_ID}"/* "${APPDIR}/usr/bin/binaries/${PLATFORM_ID}/"
        chmod +x "${APPDIR}/usr/bin/binaries/${PLATFORM_ID}"/*
    fi

    # Copy native modules (must be next to executable for pkg to find them)
    echo "  Copying native modules..."
    if [ -d "${DIST_DIR}/node_modules" ]; then
        cp -r "${DIST_DIR}/node_modules"/* "${APPDIR}/usr/bin/node_modules/"
    fi

    # Copy drizzle migrations (next to executable)
    echo "  Copying database migrations..."
    if [ -d "${DIST_DIR}/drizzle" ]; then
        cp -r "${DIST_DIR}/drizzle"/* "${APPDIR}/usr/bin/drizzle/"
    fi

    # Copy icon (use 256x256 PNG)
    echo "  Copying icon..."
    local ICON_SRC="${ROOT_DIR}/frontend/public/icons/icon-256x256.png"
    if [ -f "$ICON_SRC" ]; then
        cp "$ICON_SRC" "${APPDIR}/pluton.png"
    else
        echo -e "${YELLOW}  Warning: Icon not found at ${ICON_SRC}${NC}"
    fi

    # Ensure AppRun is executable
    chmod +x "${APPDIR}/AppRun"

    # Ensure scripts are executable
    chmod +x "${APPDIR}/usr/share/pluton/install.sh"
    chmod +x "${APPDIR}/usr/share/pluton/uninstall.sh"

    # Update version in desktop file dynamically
    echo "  Updating desktop file version..."
    sed -i "s/^X-AppImage-Version=.*/X-AppImage-Version=${VERSION}/" "${APPDIR}/pluton.desktop"

    # Build AppImage
    echo "  Building AppImage..."
    local OUTPUT_FILE="${OUTPUT_DIR}/${DISPLAY_NAME}-${VERSION}-${ARCH}.AppImage"

    # Build with update information for delta updates
    local UPDATE_INFO="gh-releases-zsync|plutonhq|pluton|latest|${DISPLAY_NAME}-*-${ARCH}.AppImage.zsync"

    # Set ARCH environment variable for the target architecture
    ARCH="$ARCH" VERSION="$VERSION" "$APPIMAGETOOL" \
        --appimage-extract-and-run \
        -u "$UPDATE_INFO" \
        "$APPDIR" \
        "$OUTPUT_FILE"

    # Make AppImage executable
    chmod +x "$OUTPUT_FILE"

    # Calculate checksum
    echo "  Generating checksum..."
    sha256sum "$OUTPUT_FILE" > "${OUTPUT_FILE}.sha256"

    echo -e "${GREEN}  ✓ Built: ${OUTPUT_FILE}${NC}"
    echo "    Size: $(du -h "$OUTPUT_FILE" | cut -f1)"

    BUILT_ARCHS+=("$ARCH")
}

#######################################
# Main script
#######################################

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║           ${DISPLAY_NAME} AppImage Builder                         ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo "  Name:         ${DISPLAY_NAME}"
echo "  Version:      ${VERSION}"
echo "  Output:       ${OUTPUT_DIR}"
echo ""

# Determine which architectures to build
TARGET_ARCH="${1:-all}"

case "$TARGET_ARCH" in
    all|"")
        echo "  Mode: Build all available architectures"
        build_appimage "x64"
        build_appimage "arm64"
        ;;
    x64|x86_64|amd64)
        echo "  Mode: Build x86_64 only"
        build_appimage "x64"
        ;;
    arm64|aarch64)
        echo "  Mode: Build ARM64 only"
        build_appimage "arm64"
        ;;
    *)
        echo -e "${RED}Error: Unknown architecture: ${TARGET_ARCH}${NC}"
        echo "Usage: $0 [all|x64|arm64]"
        exit 1
        ;;
esac

# Summary
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                    Build Complete                         ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

if [ ${#BUILT_ARCHS[@]} -gt 0 ]; then
    echo -e "  ${GREEN}Successfully built:${NC}"
    for arch in "${BUILT_ARCHS[@]}"; do
        echo "    ✓ ${DISPLAY_NAME}-${VERSION}-${arch}.AppImage"
    done
fi

if [ ${#FAILED_ARCHS[@]} -gt 0 ]; then
    echo ""
    echo -e "  ${YELLOW}Skipped:${NC}"
    for arch in "${FAILED_ARCHS[@]}"; do
        echo "    ⚠ ${arch}"
    done
fi

echo ""
echo "  Output directory: ${OUTPUT_DIR}"
echo ""
echo "  Test an AppImage:"
echo "    chmod +x ${DISPLAY_NAME}-${VERSION}-x86_64.AppImage"
echo "    ./${DISPLAY_NAME}-${VERSION}-x86_64.AppImage"
echo ""
echo "  Install as service:"
echo "    sudo ./${DISPLAY_NAME}-${VERSION}-x86_64.AppImage --install"
echo ""
