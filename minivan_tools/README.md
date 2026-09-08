# MiniVAN local emulator worker

This folder is the **only** place that talks to the Android MiniVAN emulator via ADB.
Next.js enqueues `MiniVanJob` rows; `worker.py` claims them with `MINIVAN_WORKER_TOKEN`.

## Prerequisites

1. Android SDK + AVD named `minivan` (Google APIs image with `adb root`, not Play Store).
2. MiniVAN installed and **logged in** on the emulator (Auth0 session is on-device).
3. One-time DeviceUID cache: canvass any contact once, then:
   ```bash
   # after pulling responses DB, save Canvasses.DeviceUID
   echo 'Android-14-Device-…' > .device_uid_cache
   ```
4. Deny location permission for MiniVAN so the map does not hang (see `MINIVAN_DB_SCHEMA.md` §8.6).
5. StrideVote `.env`: `MINIVAN_WORKER_TOKEN=…` (same value for the worker).

## Run

```bash
./start_emulator.sh          # optional helper
export STRIDEVOTE_URL=http://localhost:3000
export MINIVAN_WORKER_TOKEN=dev-minivan-worker-token
python3 worker.py
```

Jobs run **serially**. Downloading a list wipes the previous on-device list.

## Job types

| Type | Worker | Server |
|---|---|---|
| `import_list` | download + export people (phones/emails/party) | match-or-skip, create list |
| `pull_canvass` | force download + `TeamCanvasses` only | door ResultIDs → attempts |
| `push_canvass` | inject StrideVote results + Sync | builds portable JSON |

The emulator is **not** a canvassing device. Pull never reads local `Canvasses`.
