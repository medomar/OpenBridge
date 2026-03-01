#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# test-package.sh
# Packaging smoke test — builds the standalone binary for the
# current platform and verifies:
#   1. Binary executes and --version prints the correct version
#   2. Binary responds to --health with valid JSON containing a
#      "checks" array
#
# Usage:
#   ./scripts/test-package.sh            # Auto-detect platform
#   ./scripts/test-package.sh --skip-build  # Skip rebuild (use existing binary)
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

log_step() {
  echo ""
  echo -e "${BLUE}▸ $1${NC}"
}

log_success() {
  echo -e "  ${GREEN}✔${NC} $1"
}

log_error() {
  echo -e "  ${RED}✖${NC} $1" >&2
}

log_info() {
  echo "    $1"
}

# Detect current platform → returns one of: macos-arm64, macos-x64, linux-x64, win-x64
detect_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os" in
    Darwin)
      if [[ "$arch" == "arm64" ]]; then
        echo "macos-arm64"
      else
        echo "macos-x64"
      fi
      ;;
    Linux)
      echo "linux-x64"
      ;;
    MINGW* | MSYS* | CYGWIN*)
      echo "win-x64"
      ;;
    *)
      echo "linux-x64"
      ;;
  esac
}

# Map platform → npm script name
platform_to_npm_script() {
  case "$1" in
    "macos-arm64") echo "package:mac" ;;
    "macos-x64")   echo "package:mac-x64" ;;
    "linux-x64")   echo "package:linux" ;;
    "win-x64")     echo "package:win" ;;
    *) echo "package" ;;
  esac
}

# Map platform → expected binary filename
platform_to_binary() {
  case "$1" in
    "win-x64") echo "openbridge.exe" ;;
    *)         echo "openbridge" ;;
  esac
}

# Verify that a string is valid JSON with a "checks" array
verify_health_json() {
  local json="$1"
  node -e "
    try {
      const o = JSON.parse($(printf '%s' "$json" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(d)))"));
      if (!Array.isArray(o.checks)) { process.stderr.write('Missing checks array\n'); process.exit(1); }
      process.exit(0);
    } catch (e) { process.stderr.write(e.message + '\n'); process.exit(1); }
  " 2>/dev/null
}

# ── Parse args ─────────────────────────────────────────────────

SKIP_BUILD=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build)
      SKIP_BUILD=true
      shift
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

# ── Setup ──────────────────────────────────────────────────────

cd "$PROJECT_DIR"

PLATFORM="$(detect_platform)"
NPM_SCRIPT="$(platform_to_npm_script "$PLATFORM")"
BINARY_NAME="$(platform_to_binary "$PLATFORM")"
BINARY_PATH="$PROJECT_DIR/release/$BINARY_NAME"

# Read expected version from package.json
EXPECTED_VERSION="$(node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8')); process.stdout.write(p.version);")"

# ── Header ─────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  OpenBridge Packaging Smoke Test"
echo "  Platform:  $PLATFORM"
echo "  Version:   $EXPECTED_VERSION"
echo "  Binary:    release/$BINARY_NAME"
echo "═══════════════════════════════════════════════════════════"

# ── Step 1: Build ──────────────────────────────────────────────

if [[ "$SKIP_BUILD" == "true" ]]; then
  log_step "Step 1: Build (skipped — using existing binary)"
else
  log_step "Step 1: Build binary"
  log_info "Running: npm run $NPM_SCRIPT"
  npm run "$NPM_SCRIPT"
  log_success "Build complete"
fi

# Verify binary exists
if [[ ! -f "$BINARY_PATH" ]]; then
  log_error "Binary not found: $BINARY_PATH"
  echo ""
  echo "Hint: run 'npm run $NPM_SCRIPT' to build the binary first."
  exit 1
fi

BINARY_SIZE="$(du -sh "$BINARY_PATH" | cut -f1)"
log_success "Binary exists: release/$BINARY_NAME ($BINARY_SIZE)"

# ── Step 2: Test --version ─────────────────────────────────────

log_step "Step 2: Test --version flag"

VERSION_OUTPUT="$("$BINARY_PATH" --version 2>/dev/null)" || {
  log_error "Binary exited with non-zero status for --version"
  exit 1
}

log_info "Output: $VERSION_OUTPUT"

if [[ "$VERSION_OUTPUT" != "$EXPECTED_VERSION" ]]; then
  log_error "--version mismatch. Expected: '$EXPECTED_VERSION', got: '$VERSION_OUTPUT'"
  exit 1
fi

log_success "--version outputs correct version: $VERSION_OUTPUT"

# ── Step 3: Test --health ──────────────────────────────────────

log_step "Step 3: Test --health flag"

# --health exits 0 when all checks pass, 1 when some fail.
# Either exit code is acceptable for a smoke test — we only care
# that the output is valid JSON with a "checks" array.
HEALTH_OUTPUT="$("$BINARY_PATH" --health 2>/dev/null)" || true

log_info "Output: ${HEALTH_OUTPUT:0:200}$([ ${#HEALTH_OUTPUT} -gt 200 ] && echo '...')"

if [[ -z "$HEALTH_OUTPUT" ]]; then
  log_error "--health produced no output"
  exit 1
fi

# Validate JSON using node
if ! echo "$HEALTH_OUTPUT" | node -e "
  process.stdin.resume();
  let d = '';
  process.stdin.on('data', c => d += c);
  process.stdin.on('end', () => {
    try {
      const o = JSON.parse(d);
      if (!Array.isArray(o.checks)) {
        process.stderr.write('Missing checks array in JSON output\n');
        process.exit(1);
      }
      process.exit(0);
    } catch (e) {
      process.stderr.write('Invalid JSON: ' + e.message + '\n');
      process.exit(1);
    }
  });
" 2>/tmp/openbridge-health-check-err; then
  log_error "--health output is not valid JSON or missing 'checks' array"
  cat /tmp/openbridge-health-check-err >&2
  echo "Raw output:" >&2
  echo "$HEALTH_OUTPUT" >&2
  exit 1
fi

log_success "--health outputs valid JSON with 'checks' array"

# ── Summary ────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════"
echo -e "  ${GREEN}✔ Packaging smoke test PASSED${NC}"
echo "═══════════════════════════════════════════════════════════"
echo "  Platform:  $PLATFORM"
echo "  Version:   $VERSION_OUTPUT"
echo "  Binary:    $BINARY_PATH"
echo "═══════════════════════════════════════════════════════════"
echo ""
