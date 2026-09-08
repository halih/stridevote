#!/usr/bin/env bash
# pull_responses_db.sh — pull MiniVAN's on-device responses DB to a local file.
#
# Force-stops the app first for a consistent read (no in-flight writes), then
# copies canvass_<LISTID>_responses.db off the device.
#
# Usage:  ./pull_responses_db.sh <LISTID> [OUTPUT_PATH]
#   LISTID       e.g. 280640
#   OUTPUT_PATH  default: ./canvass_<LISTID>_responses.db
set -euo pipefail

LISTID="${1:?usage: pull_responses_db.sh <LISTID> [OUTPUT_PATH]}"
OUT="${2:-./canvass_${LISTID}_responses.db}"
PKG=com.voteractivationnetwork.minivan
REMOTE="/data/data/$PKG/files/canvass_${LISTID}_responses.db"

ADB="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}/platform-tools/adb"
command -v adb >/dev/null 2>&1 && ADB=adb

"$ADB" root >/dev/null 2>&1 || true
sleep 1
echo "force-stopping app for a clean read..."
"$ADB" shell am force-stop "$PKG"
echo "pulling $REMOTE -> $OUT"
"$ADB" exec-out "cat $REMOTE" > "$OUT"
echo "pulled $(wc -c < "$OUT") bytes"
echo "Canvasses rows: $("${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}/platform-tools/sqlite3" "$OUT" 'SELECT COUNT(*) FROM Canvasses;' 2>/dev/null || sqlite3 "$OUT" 'SELECT COUNT(*) FROM Canvasses;')"
