#!/usr/bin/env bash
# start_emulator.sh — boot the MiniVAN AVD and always pin GPS to Pioneer Square.
# Use this INSTEAD of `emulator -avd minivan` so location is set every time.
#
# Usage:  ./start_emulator.sh [AVD_NAME]
set -euo pipefail

AVD="${1:-minivan}"
SDK="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
ADB="$SDK/platform-tools/adb"
EMU="$SDK/emulator/emulator"
HERE="$(cd "$(dirname "$0")" && pwd)"

# boot detached if not already running
if ! "$ADB" devices | grep -q emulator; then
  echo "booting AVD '$AVD'..."
  nohup "$EMU" -avd "$AVD" -gpu auto >/tmp/minivan-emulator.log 2>&1 &
fi

echo "waiting for device..."
"$ADB" wait-for-device
for i in $(seq 1 60); do
  [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
  sleep 5
done
"$ADB" root >/dev/null 2>&1 || true
sleep 1

echo "pinning location to Pioneer Square..."
bash "$HERE/set_location.sh"
echo "ready."
