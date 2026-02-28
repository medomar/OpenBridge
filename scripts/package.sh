#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# package.sh
# Builds standalone binaries for all platforms using @yao-pkg/pkg.
#
# Usage:
#   ./scripts/package.sh                          # Build all platforms
#   ./scripts/package.sh --platform macos-arm64   # macOS ARM64 only
#   ./scripts/package.sh --platform macos-x64     # macOS x64 only
#   ./scripts/package.sh --platform win-x64       # Windows x64 only
#   ./scripts/package.sh --platform linux-x64     # Linux x64 only
#   ./scripts/package.sh --help                   # Show this help
# ─────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ── Helpers ────────────────────────────────────────────────────

# Map platform short name → pkg target string
platform_to_target() {
  case "$1" in
    "macos-arm64") echo "node22-macos-arm64" ;;
    "macos-x64")   echo "node22-macos-x64" ;;
    "win-x64")     echo "node22-win-x64" ;;
    "linux-x64")   echo "node22-linux-x64" ;;
    *) echo "" ;;
  esac
}

# Expected binary name for a single-platform build (pkg omits platform suffix)
single_binary_name() {
  case "$1" in
    "win-x64") echo "openbridge.exe" ;;
    *)         echo "openbridge" ;;
  esac
}

# ── Parse args ─────────────────────────────────────────────────

PLATFORM=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform)
      if [[ -z "${2:-}" ]]; then
        echo -e "${RED}ERROR: --platform requires a value${NC}" >&2
        exit 1
      fi
      PLATFORM="$2"
      shift 2
      ;;
    --help | -h)
      grep '^#' "$0" | grep -v '^#!/' | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo -e "${RED}ERROR: Unknown option: $1${NC}" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
done

# ── Validate platform ──────────────────────────────────────────

VALID_PLATFORMS=("macos-arm64" "macos-x64" "win-x64" "linux-x64")

if [[ -n "$PLATFORM" ]]; then
  VALID=false
  for p in "${VALID_PLATFORMS[@]}"; do
    [[ "$PLATFORM" == "$p" ]] && VALID=true && break
  done
  if [[ "$VALID" != "true" ]]; then
    echo -e "${RED}ERROR: Unknown platform: $PLATFORM${NC}" >&2
    echo "Valid platforms: ${VALID_PLATFORMS[*]}" >&2
    exit 1
  fi
fi

# ── Resolve targets and expected binaries ──────────────────────

if [[ -n "$PLATFORM" ]]; then
  # Single-platform build
  TARGETS_STR="$(platform_to_target "$PLATFORM")"
  EXPECTED_BINARIES=("$(single_binary_name "$PLATFORM")")
else
  # All-platform build
  TARGETS_STR="node22-macos-arm64,node22-macos-x64,node22-win-x64,node22-linux-x64"
  EXPECTED_BINARIES=(
    "openbridge-macos-arm64"
    "openbridge-macos-x64"
    "openbridge-win-x64.exe"
    "openbridge-linux-x64"
  )
fi

# ── Header ─────────────────────────────────────────────────────

VERSION="$(node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8')); process.stdout.write(p.version);" 2>/dev/null || echo "unknown")"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  OpenBridge Binary Packager  v${VERSION}"
echo "  Platform: ${PLATFORM:-all}"
echo "  Targets:  ${TARGETS_STR}"
echo "═══════════════════════════════════════════════════════════"
echo ""

cd "$PROJECT_DIR"

# ── Step 1: Build TypeScript ───────────────────────────────────

echo -e "${BLUE}[1/3]${NC} Compiling TypeScript..."
npm run build
echo -e "${GREEN}✓${NC} TypeScript compiled → dist/"

# ── Step 2: Package binaries ──────────────────────────────────

echo ""
echo -e "${BLUE}[2/3]${NC} Packaging binaries..."
echo "       Targets: ${TARGETS_STR}"
echo "       Output:  release/openbridge"
echo ""

mkdir -p "$PROJECT_DIR/release"

npx pkg . --targets "${TARGETS_STR}" --output "release/openbridge"

# Single-platform builds produce "openbridge" (no suffix).
# Rename to include platform suffix so downstream scripts (create-dmg.sh) can find it.
if [[ -n "$PLATFORM" ]]; then
  SRC_NAME="$(single_binary_name "$PLATFORM")"
  case "$PLATFORM" in
    "win-x64") DEST_NAME="openbridge-win-x64.exe" ;;
    *)         DEST_NAME="openbridge-${PLATFORM}" ;;
  esac
  if [[ "$SRC_NAME" != "$DEST_NAME" && -f "$PROJECT_DIR/release/$SRC_NAME" ]]; then
    mv "$PROJECT_DIR/release/$SRC_NAME" "$PROJECT_DIR/release/$DEST_NAME"
    EXPECTED_BINARIES=("$DEST_NAME")
  fi
fi

echo ""
echo -e "${GREEN}✓${NC} Packaging complete"

# ── Step 3: Verify output binaries ────────────────────────────

echo ""
echo -e "${BLUE}[3/3]${NC} Verifying output binaries..."
echo ""

FAILED=0
for binary in "${EXPECTED_BINARIES[@]}"; do
  BINARY_PATH="$PROJECT_DIR/release/$binary"
  if [[ -f "$BINARY_PATH" ]]; then
    SIZE="$(du -sh "$BINARY_PATH" | cut -f1)"
    echo -e "  ${GREEN}✓${NC}  release/${binary}  (${SIZE})"
  else
    echo -e "  ${RED}✗${NC}  release/${binary}  ${YELLOW}(MISSING)${NC}"
    FAILED=$((FAILED + 1))
  fi
done

echo ""

if [[ $FAILED -gt 0 ]]; then
  echo -e "${RED}ERROR: ${FAILED} binary/binaries not found in release/.${NC}"
  exit 1
fi

echo -e "${GREEN}All binaries built successfully.${NC}"
echo ""
echo "Output directory: ${PROJECT_DIR}/release/"
echo ""
