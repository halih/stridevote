#!/usr/bin/env python3
"""
apply_and_sync.py — apply export_list_json.py-shaped JSON onto a DIFFERENT
MiniVAN list already active on the emulator, then launch the app and confirm
it auto-synced the results up to VAN.

Pipeline (each step is one of this toolkit's existing tools, run in sequence):
    1. force-stop the app, pull the target list's List DB + Responses DB
    2. apply_to_list.py    -> match voters by name/address, remap survey text
                              to this list's own script -> CSV
    3. inject_canvass.py   -> write faithful Canvass* rows into the pulled
                              Responses DB (needs a DeviceUID — see below)
    4. push_responses_db.sh -> push the edited DB back onto the device, and
                              flip the app's own "has_modified_data" pref flag
                              (see mark_data_modified() — required for the
                              upload to actually fire; see there for why)
    5. relaunch the app and tap its sync icon (passive auto-sync-on-launch has
       unpredictable latency — a few seconds to indefinitely more than a
       minute for larger batches); wait for the "Sync Successful" dialog.

DeviceUID: inject_canvass.py normally reads this off an existing Canvasses row
on the target list, but a list nobody has canvassed FROM THIS DEVICE yet has
none to read. It's stable per-emulator (not per-list), so it only needs to be
captured once: `.device_uid_cache` next to this script holds it. To (re)create
that cache on a new AVD: open the app, canvass any one voter with "I Couldn't
Reach This Contact" -> any reason, force-stop, read Canvasses.DeviceUID from
that list's responses DB, delete that throwaway row, and save the value to
`.device_uid_cache`. (Not automated here — it's a one-time-per-emulator step
and the exact UI path varies too much across list layouts to script reliably.)

Usage:
    python3 apply_and_sync.py <ListID> --json export.json [--sync-timeout 60]

Prints a JSON summary to stdout on success (nonzero exit + stderr on failure).
Assumes <ListID> is ALREADY the active, downloaded list (see download_list.py).
"""
import argparse, json, os, re, subprocess, sys, tempfile, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import download_list as dl  # reuse adb/dump_ui/tap helpers

PKG = dl.PKG
HERE = os.path.dirname(os.path.abspath(__file__))
DEVICE_UID_CACHE = os.path.join(HERE, ".device_uid_cache")


def pull_dbs(list_id, workdir):
    dl.adb("root", check=False)
    dl.adb_shell(f"am force-stop {PKG}")
    list_db = os.path.join(workdir, f"canvass_{list_id}.db")
    resp_db = os.path.join(workdir, f"canvass_{list_id}_responses.db")
    for remote, local in ((f"canvass_{list_id}.db", list_db), (f"canvass_{list_id}_responses.db", resp_db)):
        # binary DB bytes — must NOT go through dl.adb()'s text=True decoding
        r = subprocess.run([dl.ADB, "exec-out", f"cat /data/data/{PKG}/files/{remote}"], capture_output=True)
        if not r.stdout:
            sys.exit(f"ERROR: /data/data/{PKG}/files/{remote} is empty/missing — "
                      f"is {list_id} actually the active, downloaded list?")
        with open(local, "wb") as f:
            f.write(r.stdout)
    return list_db, resp_db


def mark_data_modified():
    """Flip the app's own "has_modified_data" SharedPreferences flag to true.

    Relaunching after a raw SQLite injection does NOT reliably trigger MiniVAN's
    auto-sync: it decides whether anything is pending from this prefs flag (set
    by its own in-app recording code), not by scanning Canvasses for new rows.
    Injecting rows without also setting this leaves the app thinking there's
    nothing to upload — confirmed empirically (relaunch alone: sync_status
    never left "Last synced N ago"; flipping this flag first: "Last synced just
    now" on every relaunch). The app must be stopped while this is edited.
    """
    prefs_path = f"/data/data/{PKG}/shared_prefs/{PKG}_preferences.xml"
    r = dl.adb_shell(f"cat {prefs_path}", check=False)
    xml = r.stdout
    if not xml.strip():
        return  # no prefs file yet (shouldn't happen once a list is active) — nothing to patch
    if 'name="has_modified_data" value="true"' in xml:
        return
    if 'name="has_modified_data"' in xml:
        new_xml = xml.replace('<boolean name="has_modified_data" value="false" />',
                               '<boolean name="has_modified_data" value="true" />')
    else:
        new_xml = xml.replace("</map>", '    <boolean name="has_modified_data" value="true" />\n</map>')

    own = dl.adb_shell(f"stat -c '%u:%g' {prefs_path}", check=False).stdout.strip()
    with tempfile.NamedTemporaryFile(mode="w", suffix=".xml", delete=False) as f:
        f.write(new_xml)
        tmp_local = f.name
    tmp_remote = f"/data/local/tmp/{PKG}_prefs_patch.xml"
    try:
        dl.adb("push", tmp_local, tmp_remote, check=False)
        dl.adb_shell(f"cp {tmp_remote} {prefs_path} && rm -f {tmp_remote}")
        if own:
            dl.adb_shell(f"chown {own} {prefs_path} && chmod 660 {prefs_path}")
    finally:
        os.unlink(tmp_local)


def inject_push_and_sync(list_id, list_db, resp_db, csv_path, sync_timeout):
    """Write csv_path's rows into resp_db, push it back onto the device, and
    confirm a real sync. Returns (injected: bool, synced: bool, sync_result: str|None).
    Raises SystemExit on a hard failure (inject/push errors)."""
    device_uid_args = []
    if os.path.exists(DEVICE_UID_CACHE):
        device_uid_args = ["--device-uid", open(DEVICE_UID_CACHE).read().strip()]

    r = subprocess.run(
        [sys.executable, os.path.join(HERE, "inject_canvass.py"),
         "--responses-db", resp_db, "--list-db", list_db, "--csv", csv_path, *device_uid_args],
        capture_output=True, text=True)
    if r.returncode != 0:
        hint = ""
        if "DeviceUID" in r.stderr:
            hint = (" (no cached DeviceUID for this emulator and none could be auto-detected — "
                    "see this script's module docstring for the one-time bootstrap step)")
        sys.exit(f"ERROR: inject_canvass.py failed: {r.stderr.strip()}{hint}")

    r = subprocess.run(["bash", os.path.join(HERE, "push_responses_db.sh"), str(list_id), resp_db],
                        capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"ERROR: push_responses_db.sh failed: {r.stderr.strip()}")

    mark_data_modified()  # app is still stopped (push script's last act) — safe to edit prefs
    dl.adb_shell(f"am start -n {PKG}/.ui.activities.LaunchActivity")

    # Passive auto-sync-on-launch (IsAutoSyncEnabled) has unpredictable latency —
    # observed anywhere from ~2s to indefinitely-not-within-a-minute for larger
    # batches. Explicitly tapping the header's sync icon (id/action_sync) instead
    # triggers an immediate attempt and a definitive "Sync Successful" alert dialog
    # (id/alertTitle) — a real confirmation instead of guessing from relative-time
    # text. Dismiss whatever onboarding tips are in the way first (same "Continue"
    # dismiss pattern as download_list.py) since a fresh launch can show one.
    synced = False
    sync_result_text = None
    tapped_sync = False
    deadline = time.time() + sync_timeout
    while time.time() < deadline:
        time.sleep(1.5)
        nodes = dl.dump_ui()

        # The dialog's title bar isn't always rendered as a separate accessible
        # node (observed both with and without an "alertTitle" node present) —
        # the message body is the reliable part, so check both.
        alert_title = next(dl.find(nodes, rid_suffix="alertTitle"), None)
        message = next(dl.find(nodes, rid_suffix="message"), None)
        alert_text = " ".join(n["text"] for n in (alert_title, message) if n)
        if alert_text and "sync" in alert_text.lower():
            sync_result_text = alert_text
            synced = "synced" in alert_text.lower() or "successful" in alert_text.lower()
            ok_btn = next(dl.find(nodes, rid_suffix="button1"), None)
            if ok_btn:
                dl.tap(*dl.center(ok_btn["bounds"]))
            break

        if not tapped_sync:
            sync_icon = next(dl.find(nodes, rid_suffix="action_sync"), None)
            if sync_icon:
                dl.tap(*dl.center(sync_icon["bounds"]))
                tapped_sync = True
                continue

        tip = next(dl.find(nodes, text="Continue"), None)
        if tip:
            dl.tap(*dl.center(tip["bounds"])); continue

    return True, synced, sync_result_text


def run(list_id, json_path, sync_timeout, result_map=None, household_status=None):
    devices = dl.adb("devices").stdout.strip().splitlines()[1:]
    if not any(d.strip().endswith("\tdevice") for d in devices):
        sys.exit("ERROR: no ADB device/emulator attached")

    with tempfile.TemporaryDirectory() as tmp:
        list_db, resp_db = pull_dbs(list_id, tmp)

        csv_path = os.path.join(tmp, "apply.csv")
        stats_path = os.path.join(tmp, "stats.json")
        result_map_args = [a for pair in (result_map or []) for a in ("--result-map", pair)]
        household_args = [a for s in (household_status or []) for a in ("--household-status", s)]
        r = subprocess.run(
            [sys.executable, os.path.join(HERE, "apply_to_list.py"),
             "--json", json_path, "--target-list-db", list_db,
             "--out", csv_path, "--stats-json", stats_path, *result_map_args, *household_args],
            capture_output=True, text=True)
        if r.returncode != 0:
            sys.exit(f"ERROR: apply_to_list.py failed: {r.stderr.strip()}")
        stats = json.load(open(stats_path))

        if stats["rows_written"] == 0:
            print(json.dumps({"list_id": list_id, **stats, "injected": 0,
                               "pushed": False, "synced": None,
                               "note": "no matching voters with canvass data for this list; nothing to push"}))
            return

        injected, synced, sync_result_text = inject_push_and_sync(list_id, list_db, resp_db, csv_path, sync_timeout)

    print(json.dumps({
        "list_id": list_id,
        **stats,
        "injected": stats["rows_written"],
        "pushed": True,
        "synced": synced,
        "sync_result": sync_result_text,
    }))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("list_id", type=int)
    ap.add_argument("--json", required=True, help="export_list_json.py-shaped JSON to apply")
    ap.add_argument("--sync-timeout", type=int, default=60)
    ap.add_argument("--result-map", action="append", default=[],
                     help='Map a source status_label to a differently-named disposition on the '
                          'target list\'s own script, e.g. --result-map "Lit Dropped=Left Message/Lit". '
                          'Repeatable. Passed straight through to apply_to_list.py.')
    ap.add_argument("--household-status", action="append", default=[],
                     help='Additional portable status slugs applied to the whole door, not just the '
                          'matched person ("lit-dropped" is always included). Passed straight through.')
    args = ap.parse_args()
    run(args.list_id, args.json, args.sync_timeout, args.result_map, args.household_status)
