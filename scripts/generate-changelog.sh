#!/usr/bin/env bash
# generate-changelog.sh — Auto-generate changelog entries from conventional commits
#
# Usage:
#   bash scripts/generate-changelog.sh                    # Generate for next version (unreleased)
#   bash scripts/generate-changelog.sh v0.0.9             # Generate for a specific version
#   bash scripts/generate-changelog.sh v0.0.9 --apply     # Generate and insert into CHANGELOG.md
#
# Reads git log between the latest tag and HEAD (or between two tags),
# groups by conventional commit type, and outputs Keep a Changelog format.

set -euo pipefail

VERSION="${1:-}"
APPLY="${2:-}"
CHANGELOG="CHANGELOG.md"

# Determine commit range
LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -z "$LATEST_TAG" ]; then
  RANGE="HEAD"
  echo "# No previous tags found — using all commits" >&2
else
  RANGE="${LATEST_TAG}..HEAD"
  echo "# Generating changelog: ${RANGE}" >&2
fi

# Determine version header
if [ -n "$VERSION" ] && [ "$VERSION" != "--apply" ]; then
  VERSION_HEADER="## [${VERSION#v}] — $(date +%Y-%m-%d)"
else
  VERSION_HEADER="## [Unreleased]"
  if [ "$VERSION" = "--apply" ]; then
    APPLY="--apply"
    VERSION=""
  fi
fi

# Collect commits grouped by type
declare -a FEATURES=()
declare -a FIXES=()
declare -a DOCS=()
declare -a REFACTORS=()
declare -a CHORES=()
declare -a OTHERS=()

while IFS= read -r line; do
  [ -z "$line" ] && continue

  # Parse conventional commit: type(scope): description
  type=""
  scope=""
  desc=""

  # Try type(scope): desc — use sed to extract parts
  if echo "$line" | grep -qE '^[a-z]+\(.+\)!?: '; then
    type=$(echo "$line" | sed -E 's/^([a-z]+)\(.*/\1/')
    scope=$(echo "$line" | sed -E 's/^[a-z]+\(([^)]+)\).*/\1/')
    desc=$(echo "$line" | sed -E 's/^[a-z]+\([^)]+\)!?: //')
  elif echo "$line" | grep -qE '^[a-z]+!?: '; then
    type=$(echo "$line" | sed -E 's/^([a-z]+)!?: .*/\1/')
    desc=$(echo "$line" | sed -E 's/^[a-z]+!?: //')
  else
    OTHERS+=("- ${line}")
    continue
  fi

  # Format entry
  if [ -n "$scope" ]; then
    entry="- **${scope}**: ${desc}"
  else
    entry="- ${desc}"
  fi

  case "$type" in
    feat)     FEATURES+=("$entry") ;;
    fix)      FIXES+=("$entry") ;;
    docs)     DOCS+=("$entry") ;;
    refactor) REFACTORS+=("$entry") ;;
    chore|ci|build|deps) CHORES+=("$entry") ;;
    *)        OTHERS+=("$entry") ;;
  esac
done < <(git log "$RANGE" --pretty=format:"%s" --no-merges 2>/dev/null)

# Build output
OUTPUT=""
OUTPUT+="${VERSION_HEADER}"$'\n'
OUTPUT+=""$'\n'

if [ ${#FEATURES[@]} -gt 0 ]; then
  OUTPUT+="### Added"$'\n'
  OUTPUT+=""$'\n'
  for entry in "${FEATURES[@]}"; do
    OUTPUT+="${entry}"$'\n'
  done
  OUTPUT+=""$'\n'
fi

if [ ${#FIXES[@]} -gt 0 ]; then
  OUTPUT+="### Fixed"$'\n'
  OUTPUT+=""$'\n'
  for entry in "${FIXES[@]}"; do
    OUTPUT+="${entry}"$'\n'
  done
  OUTPUT+=""$'\n'
fi

if [ ${#DOCS[@]} -gt 0 ] || [ ${#REFACTORS[@]} -gt 0 ] || [ ${#CHORES[@]} -gt 0 ]; then
  OUTPUT+="### Changed"$'\n'
  OUTPUT+=""$'\n'
  for entry in "${DOCS[@]}"; do
    OUTPUT+="${entry}"$'\n'
  done
  for entry in "${REFACTORS[@]}"; do
    OUTPUT+="${entry}"$'\n'
  done
  for entry in "${CHORES[@]}"; do
    OUTPUT+="${entry}"$'\n'
  done
  OUTPUT+=""$'\n'
fi

if [ ${#OTHERS[@]} -gt 0 ]; then
  OUTPUT+="### Other"$'\n'
  OUTPUT+=""$'\n'
  for entry in "${OTHERS[@]}"; do
    OUTPUT+="${entry}"$'\n'
  done
  OUTPUT+=""$'\n'
fi

# If no commits found
if [ ${#FEATURES[@]} -eq 0 ] && [ ${#FIXES[@]} -eq 0 ] && [ ${#DOCS[@]} -eq 0 ] && \
   [ ${#REFACTORS[@]} -eq 0 ] && [ ${#CHORES[@]} -eq 0 ] && [ ${#OTHERS[@]} -eq 0 ]; then
  OUTPUT+="_No changes since ${LATEST_TAG:-initial commit}._"$'\n'
  OUTPUT+=""$'\n'
fi

# Apply mode: insert into CHANGELOG.md
if [ "$APPLY" = "--apply" ]; then
  if [ ! -f "$CHANGELOG" ]; then
    echo "Error: $CHANGELOG not found" >&2
    exit 1
  fi

  # Replace the [Unreleased] section with the new version + a fresh [Unreleased]
  TEMP=$(mktemp)
  awk -v new_content="$OUTPUT" '
    /^## \[Unreleased\]/ {
      print "## [Unreleased]"
      print ""
      print "_No unreleased changes._"
      print ""
      printf "%s", new_content
      found = 1
      next
    }
    found && /^## \[/ { found = 0 }
    !found { print }
  ' "$CHANGELOG" > "$TEMP"
  mv "$TEMP" "$CHANGELOG"
  echo "# Updated $CHANGELOG with ${VERSION_HEADER}" >&2
else
  # Print to stdout
  echo "$OUTPUT"
fi
