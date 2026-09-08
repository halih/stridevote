#!/usr/bin/env bash
# set_location.sh — pin the running emulator's GPS to a fixed point.
# Default: Pioneer Square, Seattle, WA. Enables the location stack, grants
# MiniVAN location perms, and re-sends the fix a few times so Google Play's
# fused provider latches onto it.
#
# Usage:  ./set_location.sh [LAT] [LON]
set -euo pipefail

LAT="${1:-47.6009}"     # Pioneer Square, Seattle
LON="${2:--122.3344}"
PKG=com.voteractivationnetwork.minivan

ADB="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}/platform-tools/adb"
command -v adb >/dev/null 2>&1 && ADB=adb

"$ADB" shell settings put secure location_mode 3 >/dev/null 2>&1 || true
"$ADB" shell pm grant $PKG android.permission.ACCESS_FINE_LOCATION 2>/dev/null || true
"$ADB" shell pm grant $PKG android.permission.ACCESS_COARSE_LOCATION 2>/dev/null || true
"$ADB" shell appops set $PKG android:fine_location allow 2>/dev/null || true
"$ADB" shell appops set $PKG android:coarse_location allow 2>/dev/null || true

# emulator console wants:  geo fix <longitude> <latitude> [altitude]
for i in 1 2 3 4 5 6; do "$ADB" emu geo fix "$LON" "$LAT" 0 >/dev/null 2>&1 || true; sleep 1; done
echo "location pinned to LAT=$LAT LON=$LON (Pioneer Square default)"
