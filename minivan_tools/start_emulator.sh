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

# A booted emulator stays up. Anything else (missing, offline, or a qemu that
# never finished booting) is replaced. Double-fork into a new session and ignore
# SIGHUP: a plain `nohup &` is still in the launching shell's process group, and
# that shell exiting kills the emulator with no crash.
emulator_booted() {
  "$ADB" devices | awk 'NR>1 && $1 ~ /^emulator-/ && $2=="device" {ok=1} END{exit !ok}' || return 1
  [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]
}

if ! emulator_booted; then
  if pgrep -f "qemu-system.*-avd ${AVD}" >/dev/null 2>&1; then
    echo "restarting stale AVD '$AVD'..."
    "$ADB" emu kill >/dev/null 2>&1 || true
    pkill -f "qemu-system.*-avd ${AVD}" >/dev/null 2>&1 || true
    sleep 2
  fi
  echo "booting AVD '$AVD'..."
  python3 - "$EMU" "$AVD" <<'PY'
import os, signal, sys
signal.signal(signal.SIGHUP, signal.SIG_IGN)
emu, avd = sys.argv[1], sys.argv[2]
read_null = os.open(os.devnull, os.O_RDONLY)
log = os.open("/tmp/minivan-emulator.log", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
if os.fork() > 0:
    raise SystemExit(0)
os.setsid()
if os.fork() > 0:
    raise SystemExit(0)
os.dup2(read_null, 0)
os.dup2(log, 1)
os.dup2(log, 2)
os.execv(emu, [emu, "-avd", avd, "-gpu", "auto", "-no-metrics"])
PY
fi

echo "waiting for device..."
appeared=0
for i in $(seq 1 90); do
  if "$ADB" devices | awk 'NR>1 && $1 ~ /^emulator-/ && $2=="device" {ok=1} END{exit !ok}'; then
    appeared=1
    break
  fi
  sleep 2
done
if [ "$appeared" != 1 ]; then
  echo "ERROR: emulator did not come online" >&2
  exit 1
fi
booted=0
for i in $(seq 1 60); do
  if [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
    booted=1
    break
  fi
  sleep 5
done
if [ "$booted" != 1 ]; then
  echo "ERROR: emulator did not finish booting" >&2
  exit 1
fi
"$ADB" root >/dev/null 2>&1 || true
sleep 1

echo "pinning location to Pioneer Square..."
bash "$HERE/set_location.sh"
echo "ready."
