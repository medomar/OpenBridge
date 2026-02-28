#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# create-dmg.sh
# Creates a macOS .dmg installer from the ARM64 binary.
#
# Prerequisites (optional — falls back to hdiutil if unavailable):
#   brew install create-dmg
#
# Usage:
#   ./scripts/create-dmg.sh          # Build ARM64 .dmg (default)
#   ./scripts/create-dmg.sh --help   # Show this help
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

# ── Parse args ─────────────────────────────────────────────────

for arg in "$@"; do
  case "$arg" in
    --help | -h)
      grep '^#' "$0" | grep -v '^#!/' | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo -e "${RED}ERROR: Unknown option: $arg${NC}" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
done

# ── macOS check ────────────────────────────────────────────────

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo -e "${RED}ERROR: create-dmg.sh must be run on macOS.${NC}" >&2
  exit 1
fi

# ── Read version ───────────────────────────────────────────────

VERSION="$(node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8')); process.stdout.write(p.version);" 2>/dev/null || echo "unknown")"

APP_NAME="OpenBridge"
BINARY_SRC="$PROJECT_DIR/release/openbridge-macos-arm64"
DMG_NAME="${APP_NAME}-${VERSION}-macOS.dmg"
DMG_OUT="$PROJECT_DIR/release/$DMG_NAME"
WINDOW_W=600
WINDOW_H=400

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  OpenBridge DMG Creator  v${VERSION}"
echo "  Input:   release/openbridge-macos-arm64"
echo "  Output:  release/${DMG_NAME}"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── Verify input binary ────────────────────────────────────────

if [[ ! -f "$BINARY_SRC" ]]; then
  echo -e "${RED}ERROR: Binary not found: release/openbridge-macos-arm64${NC}" >&2
  echo "Run './scripts/package.sh --platform macos-arm64' first." >&2
  exit 1
fi

# ── Create temp staging directory ─────────────────────────────

STAGING_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGING_DIR"' EXIT

echo -e "${BLUE}[1/3]${NC} Preparing staging directory..."

# Copy binary with the app display name
cp "$BINARY_SRC" "$STAGING_DIR/$APP_NAME"
chmod +x "$STAGING_DIR/$APP_NAME"

# Symlink to Applications for drag-and-drop installation
ln -s /Applications "$STAGING_DIR/Applications"

echo -e "${GREEN}✓${NC} Staged: ${APP_NAME} + Applications symlink"

# ── Create background image (simple gradient via Python) ───────

BG_PATH=""
if command -v python3 &>/dev/null; then
  BG_PATH="$STAGING_DIR/.background.png"
  python3 - "$BG_PATH" "$WINDOW_W" "$WINDOW_H" <<'PYEOF'
import sys
import struct
import zlib

out_path = sys.argv[1]
width = int(sys.argv[2])
height = int(sys.argv[3])

def make_png(width, height, rows):
    def chunk(name, data):
        c = name + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)

    raw = b''
    for row in rows:
        raw += b'\x00' + bytes(row)

    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    idat_data = zlib.compress(raw, 9)

    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', ihdr_data)
        + chunk(b'IDAT', idat_data)
        + chunk(b'IEND', b'')
    )

# Generate a horizontal gradient: dark grey (#1c1c2e) → slate (#3b4a6b)
r1, g1, b1 = 0x1c, 0x1c, 0x2e  # left color
r2, g2, b2 = 0x3b, 0x4a, 0x6b  # right color

rows = []
for y in range(height):
    row = []
    for x in range(width):
        t = x / max(width - 1, 1)
        r = int(r1 + (r2 - r1) * t)
        g = int(g1 + (g2 - g1) * t)
        b = int(b1 + (b2 - b1) * t)
        row.extend([r, g, b])
    rows.append(row)

png_bytes = make_png(width, height, rows)
with open(out_path, 'wb') as f:
    f.write(png_bytes)

print(f"Background created: {width}x{height} gradient PNG")
PYEOF
  echo -e "${GREEN}✓${NC} Background gradient created"
else
  echo -e "${YELLOW}⚠${NC}  python3 not found — skipping background image"
fi

# ── Build .dmg ─────────────────────────────────────────────────

echo ""
echo -e "${BLUE}[2/3]${NC} Creating .dmg..."

if command -v create-dmg &>/dev/null; then
  # ── create-dmg path (better UI, drag-to-Applications arrow) ──
  echo "       Using: create-dmg (Homebrew)"

  CREATE_DMG_ARGS=(
    --volname "$APP_NAME"
    --window-pos 200 120
    --window-size "$WINDOW_W" "$WINDOW_H"
    --icon-size 80
    --icon "$APP_NAME" 170 190
    --hide-extension "$APP_NAME"
    --app-drop-link 430 190
    --no-internet-enable
  )

  if [[ -n "$BG_PATH" && -f "$BG_PATH" ]]; then
    CREATE_DMG_ARGS+=(--background "$BG_PATH")
  fi

  create-dmg "${CREATE_DMG_ARGS[@]}" "$DMG_OUT" "$STAGING_DIR" || {
    echo -e "${YELLOW}⚠${NC}  create-dmg failed — falling back to hdiutil"
    hdiutil create \
      -volname "$APP_NAME" \
      -srcfolder "$STAGING_DIR" \
      -ov \
      -format UDZO \
      "$DMG_OUT"
  }
else
  # ── hdiutil fallback ──────────────────────────────────────────
  echo "       Using: hdiutil (built-in, install create-dmg for a nicer DMG)"

  hdiutil create \
    -volname "$APP_NAME" \
    -srcfolder "$STAGING_DIR" \
    -ov \
    -format UDZO \
    "$DMG_OUT"
fi

echo -e "${GREEN}✓${NC} .dmg created"

# ── Verify output ──────────────────────────────────────────────

echo ""
echo -e "${BLUE}[3/3]${NC} Verifying output..."

if [[ -f "$DMG_OUT" ]]; then
  SIZE="$(du -sh "$DMG_OUT" | cut -f1)"
  echo -e "  ${GREEN}✓${NC}  release/${DMG_NAME}  (${SIZE})"
else
  echo -e "  ${RED}✗${NC}  release/${DMG_NAME}  ${YELLOW}(MISSING)${NC}" >&2
  exit 1
fi

echo ""
echo -e "${GREEN}DMG created successfully.${NC}"
echo ""
echo "Output: ${DMG_OUT}"
echo ""
echo "To install create-dmg for a nicer DMG with drag-to-Applications arrow:"
echo "  brew install create-dmg"
echo ""
