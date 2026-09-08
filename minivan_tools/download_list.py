#!/usr/bin/env python3
"""
download_list.py — drive MiniVAN's own UI (via ADB) to make a printed list number
the active, downloaded list on the emulator, then print its internal ListID.

There is no API for "download this list" — the only way to get a new list's data
onto the device is the app's real "Download a new list" flow, so this script taps
through it: Menu -> Download a new list -> confirm -> Enter a List Number ->
type the two halves -> Download List -> wait for MainActivity to come back.

IMPORTANT — confirming "Download a new list" wipes the *currently active* list's
on-device data (canvass_<oldid>.db and canvass_<oldid>_responses.db) immediately,
before the new number is even validated (see MINIVAN_DB_SCHEMA.md §9.7). An
invalid list number therefore leaves the device with NO active list at all. To
avoid pointless data loss, this script does nothing (no UI interaction at all)
when the requested printed number is already the active, downloaded list.

Usage:
    python3 download_list.py <printed-list-number>   # e.g. 57429198-80406

Prints the resulting internal ListID to stdout on success (exit 0).
On failure (list not found, automation got stuck) prints an error to stderr
and exits nonzero. The device's active list is left however the app leaves it
(untouched on the fast-path skip; either downloaded or absent otherwise).
"""
import argparse, os, re, subprocess, sys, time

PKG = "com.voteractivationnetwork.minivan"
UI_DUMP_REMOTE = "/sdcard/download_list_ui.xml"


def adb_bin():
    sdk = os.environ.get("ANDROID_HOME", "/opt/homebrew/share/android-commandlinetools")
    candidate = f"{sdk}/platform-tools/adb"
    if subprocess.run(["which", "adb"], capture_output=True).returncode == 0:
        return "adb"
    return candidate


ADB = adb_bin()


def adb(*args, check=True):
    return subprocess.run([ADB, *args], capture_output=True, text=True, check=check)


def adb_shell(cmd, check=True):
    return adb("shell", cmd, check=check)


def read_prefs():
    """Return dict of the active-list shared_prefs (empty if no list active/present)."""
    r = adb_shell(f"cat /data/data/{PKG}/shared_prefs/{PKG}_preferences.xml", check=False)
    if r.returncode != 0 or not r.stdout.strip():
        return {}
    out = {}
    for m in re.finditer(r'<string name="([^"]+)">([^<]*)</string>', r.stdout):
        out[m.group(1)] = m.group(2)
    return out


def dump_ui():
    """Return a list of (text, resource_id, class, bounds, clickable) for every node.

    `uiautomator dump` intermittently fails (esp. right after a tap/keyboard
    transition) without a nonzero exit code, leaving the PREVIOUS dump file on
    device untouched — silently returning stale bounds from an earlier screen.
    Delete the file first and retry until a fresh, parseable dump shows up.
    """
    adb_shell(f"rm -f {UI_DUMP_REMOTE}", check=False)
    xml = ""
    for _ in range(5):
        dr = adb_shell(f"uiautomator dump {UI_DUMP_REMOTE}", check=False)
        r = adb("exec-out", f"cat {UI_DUMP_REMOTE}", check=False)
        xml = r.stdout
        if "dumped to" in dr.stdout and "<hierarchy" in xml:
            break
        time.sleep(0.5)
    nodes = []
    for m in re.finditer(r"<node[^>]*>", xml):
        node = m.group(0)

        def attr(name):
            am = re.search(rf'{name}="([^"]*)"', node)
            return am.group(1) if am else ""

        nodes.append({
            "text": attr("text"),
            "rid": attr("resource-id"),
            "class": attr("class"),
            "bounds": attr("bounds"),
            "clickable": attr("clickable") == "true",
        })
    return nodes


def center(bounds):
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds)
    x1, y1, x2, y2 = map(int, m.groups())
    return (x1 + x2) // 2, (y1 + y2) // 2


def tap(x, y):
    adb_shell(f"input tap {x} {y}")


def find(nodes, rid=None, text=None, rid_suffix=None):
    for n in nodes:
        if rid is not None and n["rid"] != rid:
            continue
        if rid_suffix is not None and not n["rid"].endswith(rid_suffix):
            continue
        if text is not None and n["text"] != text:
            continue
        yield n


def top_activity():
    r = adb_shell("dumpsys activity activities", check=False)
    m = re.search(r"topResumedActivity=ActivityRecord\{[^ ]+ [^ ]+ ([^ ]+)", r.stdout)
    return m.group(1) if m else ""


def run(printed_number, timeout_s=90, force=False):
    if not re.match(r"^\d+-\d+$", printed_number):
        sys.exit(f"ERROR: '{printed_number}' doesn't look like a printed list number (expected DIGITS-DIGITS)")
    part1, part2 = printed_number.split("-")

    devices = adb("devices").stdout.strip().splitlines()[1:]
    if not any(d.strip().endswith("\tdevice") for d in devices):
        sys.exit("ERROR: no ADB device/emulator attached")
    adb("root", check=False)
    time.sleep(1)

    prefs = read_prefs()
    if not force and prefs.get("printedListNumber") == printed_number and prefs.get("activeListDownloaded") == "true":
        print(prefs["activeListId"])
        return
    # --force re-downloads even the already-active list — this WIPES its local
    # write-side data (Canvasses/CanvassSurveyResponses, see module docstring) and
    # replaces TeamCanvasses with whatever VAN currently has for this list from ALL
    # devices. That's exactly the point when the goal is verifying server-side state
    # rather than continuing to canvass locally.

    adb_shell(f"am force-stop {PKG}")
    adb_shell(f"am start -n {PKG}/.ui.activities.LaunchActivity")

    debug = os.environ.get("DOWNLOAD_LIST_DEBUG")

    filled = False       # both text fields typed into
    submitted = False    # Download List tapped
    stuck_iters = 0      # consecutive post-submit iterations still on the entry screen
    deadline = time.time() + timeout_s
    it = 0
    while time.time() < deadline:
        it += 1
        time.sleep(1.5)
        nodes = dump_ui()
        if debug:
            f1d = next(find(nodes, rid_suffix="enter_list_number_field_1"), None)
            f2d = next(find(nodes, rid_suffix="enter_list_number_field_2"), None)
            btnd = next(find(nodes, rid_suffix="btn_footer_action"), None)
            rowd = next(find(nodes, rid_suffix="enter_list_number_title"), None)
            confirmd = next(find(nodes, rid_suffix="btn_primary", text="Download a new list"), None)
            menuitemd = next(find(nodes, text="Download a new list"), None)
            menutabd = next(find(nodes, text="Menu"), None)
            tipd = next(find(nodes, text="Continue"), None)
            print(f"[{it}] filled={filled} submitted={submitted} f1={bool(f1d)} f2={bool(f2d)} "
                  f"btn={btnd['bounds'] if btnd else None} row={bool(rowd)} confirm={bool(confirmd)} "
                  f"menuitem={bool(menuitemd)} menutab={bool(menutabd)} tip={bool(tipd)} "
                  f"top={top_activity()}", file=sys.stderr)

        f1 = next(find(nodes, rid_suffix="enter_list_number_field_1"), None)
        f2 = next(find(nodes, rid_suffix="enter_list_number_field_2"), None)
        # The submit button's on-screen position shifts once the keyboard opens (the
        # fields themselves don't move) — always look it up fresh, never reuse bounds
        # captured before the keyboard appeared, or the tap lands on stale coordinates.
        dl_btn = next(find(nodes, rid_suffix="btn_footer_action"), None)

        if not filled and f1 and f2:
            tap(*center(f1["bounds"])); time.sleep(0.3)
            adb_shell(f"input text {part1}")
            tap(*center(f2["bounds"])); time.sleep(0.3)
            adb_shell(f"input text {part2}")
            filled = True
            stuck_iters = 0
            continue  # re-dump next iteration so dl_btn reflects the now-open keyboard

        if filled and not submitted and dl_btn:
            tap(*center(dl_btn["bounds"]))
            submitted = True
            stuck_iters = 0
            continue

        if submitted:
            prefs = read_prefs()
            if prefs.get("printedListNumber") == printed_number and prefs.get("activeListDownloaded") == "true" \
                    and "MainActivity" in top_activity():
                print(prefs["activeListId"])
                return
            # A successful download navigates off this screen within a few seconds. If
            # we're still looking at the (still-filled-in) entry fields several
            # iterations after submitting, the app rejected the number for some reason
            # (expired, wrong tenant, ...) — MiniVAN reports this via a Snackbar that's
            # gone by the time we next dump, so there's no reliable fixed string to
            # match; fail fast and surface whatever text is on screen right now instead
            # of silently waiting out the full timeout.
            if f1 and f2:
                stuck_iters += 1
                if stuck_iters >= 5:
                    visible = [n["text"] for n in nodes if n["text"].strip()]
                    sys.exit(f"ERROR: list '{printed_number}' was rejected after submitting "
                             f"(still on the entry screen). Visible text: {visible}")
            else:
                stuck_iters = 0
            continue  # still downloading / navigating back to My List

        row = next(find(nodes, rid_suffix="enter_list_number_title"), None)
        if row:
            tap(*center(row["bounds"])); continue

        confirm = next(find(nodes, rid_suffix="btn_primary", text="Download a new list"), None)
        if confirm:
            tap(*center(confirm["bounds"])); continue

        menu_item = next(find(nodes, text="Download a new list"), None)
        if menu_item:
            tap(*center(menu_item["bounds"])); continue

        menu_tab = next(find(nodes, text="Menu"), None)
        if menu_tab:
            tap(*center(menu_tab["bounds"])); continue

        tip = next(find(nodes, text="Continue"), None)
        if tip:
            tap(*center(tip["bounds"])); continue

        # nothing recognized (loading spinner, transition) — just wait and re-dump

    sys.exit(f"ERROR: timed out after {timeout_s}s waiting for list '{printed_number}' to become active")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("printed_number", help="printed list number, e.g. 57429198-80406")
    ap.add_argument("--timeout", type=int, default=90)
    ap.add_argument("--force", action="store_true",
                     help="re-download even if already active (wipes local write-side data; "
                          "use to verify what VAN's server actually has for this list)")
    args = ap.parse_args()
    run(args.printed_number, args.timeout, args.force)
