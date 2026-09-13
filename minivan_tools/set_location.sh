#!/usr/bin/env bash
# set_location.sh — pin the running emulator's GPS to a fixed point.
# Default: King County Elections, 919 SW Grady Way, Renton, WA.
#
# This only pins the *emulator's* location, which is what Chrome (and so the
# StrideVote web app) reads. It deliberately does NOT grant MiniVAN location
# permission: on this emulator image the fix never reaches the app's providers,
# and a permitted-but-unresolvable MiniVAN parks itself on a buttonless "We could
# not determine your location" screen that blocks download_list.py until it times
# out (see MINIVAN_DB_SCHEMA.md §8.6). Pass --grant-minivan only if you are
# deliberately testing that path.
#
# Usage:  ./set_location.sh [LAT] [LON] [--grant-minivan]
set -euo pipefail

GRANT_MINIVAN=0
ARGS=()
for a in "$@"; do
  if [ "$a" = "--grant-minivan" ]; then GRANT_MINIVAN=1; else ARGS+=("$a"); fi
done

LAT="${ARGS[0]:-47.468080}"     # King County Elections, Renton
LON="${ARGS[1]:--122.229966}"
PKG=com.voteractivationnetwork.minivan

ADB="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}/platform-tools/adb"
command -v adb >/dev/null 2>&1 && ADB=adb

"$ADB" shell settings put secure location_mode 3 >/dev/null 2>&1 || true

if [ "$GRANT_MINIVAN" = "1" ]; then
  "$ADB" shell pm grant $PKG android.permission.ACCESS_FINE_LOCATION 2>/dev/null || true
  "$ADB" shell pm grant $PKG android.permission.ACCESS_COARSE_LOCATION 2>/dev/null || true
  "$ADB" shell appops set $PKG android:fine_location allow 2>/dev/null || true
  "$ADB" shell appops set $PKG android:coarse_location allow 2>/dev/null || true
  echo "WARNING: granted MiniVAN location permission; expect it to hang on the"
  echo "         location screen and break download_list.py (see §8.6)."
fi

# emulator console wants:  geo fix <longitude> <latitude> [altitude]
for i in 1 2 3 4 5 6; do "$ADB" emu geo fix "$LON" "$LAT" 0 >/dev/null 2>&1 || true; sleep 1; done
echo "location pinned to LAT=$LAT LON=$LON (King County Elections default)"
