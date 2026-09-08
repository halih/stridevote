#!/usr/bin/env bash
# push_responses_db.sh — push an edited responses DB back into MiniVAN's sandbox.
#
# Force-stops the app, replaces canvass_<LISTID>_responses.db, removes any stale
# rollback journal (which could otherwise revert our writes), and restores the
# app's file ownership/permissions. Does NOT trigger a sync — open the app and
# tap Sync yourself when ready.
#
# Usage:  ./push_responses_db.sh <LISTID> <LOCAL_DB>
set -euo pipefail

LISTID="${1:?usage: push_responses_db.sh <LISTID> <LOCAL_DB>}"
LOCAL="${2:?usage: push_responses_db.sh <LISTID> <LOCAL_DB>}"
[ -f "$LOCAL" ] || { echo "no such file: $LOCAL" >&2; exit 1; }

PKG=com.voteractivationnetwork.minivan
FILES="/data/data/$PKG/files"
REMOTE="$FILES/canvass_${LISTID}_responses.db"
TMP="/data/local/tmp/canvass_${LISTID}_responses.db"

ADB="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}/platform-tools/adb"
command -v adb >/dev/null 2>&1 && ADB=adb

"$ADB" root >/dev/null 2>&1 || true
sleep 1

echo "force-stopping app..."
"$ADB" shell am force-stop "$PKG"

# capture current owner uid:gid and perms of the existing DB (to restore exactly)
OWN="$("$ADB" shell stat -c '%u:%g' "$REMOTE" 2>/dev/null | tr -d '\r')"
[ -z "$OWN" ] && OWN="$("$ADB" shell stat -c '%u:%g' "$FILES" | tr -d '\r')"
echo "target owner: $OWN"

echo "pushing $LOCAL ..."
"$ADB" push "$LOCAL" "$TMP" >/dev/null
"$ADB" shell "cp $TMP $REMOTE && rm -f ${REMOTE}-journal ${REMOTE}-wal ${REMOTE}-shm $TMP"
"$ADB" shell "chown $OWN $REMOTE && chmod 660 $REMOTE"
# match SELinux context of the files dir
CTX="$("$ADB" shell ls -Zd "$FILES" 2>/dev/null | awk '{print $1}' | tr -d '\r')"
[ -n "$CTX" ] && "$ADB" shell "chcon $CTX $REMOTE" 2>/dev/null || true

echo "verify on-device:"
"$ADB" shell "ls -laZ $REMOTE" | tr -d '\r'
echo "done. Open MiniVAN and tap Sync to upload."
