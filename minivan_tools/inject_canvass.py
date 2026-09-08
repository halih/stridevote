#!/usr/bin/env python3
"""
inject_canvass.py — inject custom canvass results into MiniVAN's local response DB.

The app stores pending canvass results in
    /data/data/com.voteractivationnetwork.minivan/files/canvass_<LISTID>_responses.db
On the next Sync, MiniVAN packages every row in that DB, gzips it, HMAC-signs it
(with the app's embedded key), and uploads it to VAN. By writing rows here and
letting the genuine app sync, we never need the signing key.

This script reads a CSV of desired interactions plus the downloaded list DB
(for per-voter address/city/zip), and writes faithful rows into a WORKING COPY
of the responses DB. It does NOT touch the device — use pull/push scripts for that.

CSV columns (header required):
    VanID,ResultID,SurveyResponses,Note
      VanID           - integer, must exist in the list
      ResultID        - must exist in the target list's own ScriptResults table
                        (commonly 14=Canvassed 1=NotHome 2=Refused 3=Inaccessible
                        4=Deceased 5=Moved, plus whatever else that list's script defines)
      SurveyResponses - optional; semicolon list of QID:RID
                        e.g. "734728:2947420" or "734728:2947419;734730:2947428"
      Note            - optional free text -> CanvassNotes

Example:
    2086019,14,734728:2947420,Friendly at door
    6973855,21,,

Usage:
    python3 inject_canvass.py \
        --responses-db working_responses.db \
        --list-db canvass_280640.db \
        --csv my_canvasses.csv
"""
import argparse, csv, sqlite3, sys
from datetime import datetime, timezone, timedelta


def read_export_setting(list_con, name, default=None):
    row = list_con.execute(
        "SELECT ExportSettingValue FROM ExportSettings WHERE ExportSettingName=?",
        (name,),
    ).fetchone()
    return row[0] if row else default


def detect_device_uid(resp_con, override):
    if override:
        return override
    for tbl in ("Canvasses", "CanvassSurveyResponses", "CanvassAddresses"):
        row = resp_con.execute(
            f"SELECT DeviceUID FROM {tbl} WHERE DeviceUID IS NOT NULL AND DeviceUID<>'' LIMIT 1"
        ).fetchone()
        if row:
            return row[0]
    return None


def addr_for(list_con, van_id):
    cols = ("ContactsAddressID,StreetNo,StreetNoHalf,StreetPrefix,StreetName,StreetType,"
            "StreetSuffix,AptType,AptNo,Building,City,State,Zip5,Zip4,Latitude,Longitude")
    row = list_con.execute(
        f"SELECT {cols} FROM PeopleAddresses WHERE VanID=? LIMIT 1", (van_id,)
    ).fetchone()
    if not row:
        return None
    keys = cols.split(",")
    return dict(zip(keys, row))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--responses-db", required=True, help="working copy of canvass_<id>_responses.db to modify")
    ap.add_argument("--list-db", required=True, help="the downloaded list DB canvass_<id>.db (read-only)")
    ap.add_argument("--csv", required=True, help="CSV of interactions to inject")
    ap.add_argument("--device-uid", default=None, help="override DeviceUID (else auto-detected from existing rows)")
    ap.add_argument("--start-utc", default=None,
                     help="first DateCreated, UTC 'YYYY-MM-DD HH:MM:SS', spacing forward from there. "
                          "Default: no explicit start — spaces backward from now instead, so the LAST "
                          "row is 'now' and large batches never land in the future.")
    ap.add_argument("--spacing", type=int, default=37, help="seconds between successive canvasses (default 37)")
    ap.add_argument("--dry-run", action="store_true", help="print what would be inserted; do not write")
    args = ap.parse_args()

    list_con = sqlite3.connect(args.list_db)
    resp_con = sqlite3.connect(args.responses_db)

    list_id = int(read_export_setting(list_con, "CurrentListID"))
    canvasser_id = int(read_export_setting(list_con, "CanvasserID"))
    device_uid = detect_device_uid(resp_con, args.device_uid)
    if not device_uid:
        sys.exit("ERROR: could not detect DeviceUID. Do one manual canvass first, or pass --device-uid.")

    # valid survey QID:RID pairs and result codes are this list's OWN script, not a
    # fixed global set — different lists can offer different dispositions (e.g. one
    # list has "Lit Dropped", another has "Left Message/Lit" instead).
    valid_pairs = {(q, r) for q, r in list_con.execute(
        "SELECT SurveyQuestionID, SurveyResponseID FROM ScriptSurveyQuestionResponses")}
    valid_results = {r[0] for r in list_con.execute("SELECT ResultID FROM ScriptResults")}
    people = {r[0] for r in list_con.execute("SELECT VanID FROM People")}

    next_id = (resp_con.execute("SELECT COALESCE(MAX(CanvassID),0) FROM Canvasses").fetchone()[0]) + 1
    rows = list(csv.DictReader(open(args.csv, newline="")))

    if args.start_utc:
        t0 = datetime.strptime(args.start_utc, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        dt_for = lambda i: t0 + timedelta(seconds=args.spacing * i)
    else:
        # Anchor the LAST row at "now" and space earlier ones backward, rather than
        # spacing forward from "now" for the FIRST row. Forward-spacing a large batch
        # (e.g. 150 rows * 37s ≈ 92 minutes) pushes later rows' DateCreated past the
        # actual current time — the app then thinks it has canvasses from the future,
        # which no real-time sync can ever be "after", so it shows them as perpetually
        # unsynced even once genuinely uploaded. Backward-spacing guarantees every
        # DateCreated is safely in the past regardless of batch size.
        now = datetime.now(timezone.utc)
        n = len(rows)
        dt_for = lambda i: now - timedelta(seconds=args.spacing * (n - 1 - i))

    planned = []
    for i, r in enumerate(rows):
        van = int(r["VanID"])
        result = int(r["ResultID"])
        if van not in people:
            sys.exit(f"ERROR row {i+1}: VanID {van} not in this list")
        if result not in valid_results:
            sys.exit(f"ERROR row {i+1}: ResultID {result} not valid for this list {sorted(valid_results)}")
        pairs = []
        for chunk in (r.get("SurveyResponses") or "").split(";"):
            chunk = chunk.strip()
            if not chunk:
                continue
            q, rid = (int(x) for x in chunk.split(":"))
            if (q, rid) not in valid_pairs:
                sys.exit(f"ERROR row {i+1}: survey pair {q}:{rid} not valid for this list")
            pairs.append((q, rid))
        dt = dt_for(i).strftime("%Y-%m-%d %H:%M:%S")
        planned.append((next_id + i, van, result, pairs, (r.get("Note") or "").strip(), dt))

    print(f"list_id={list_id} canvasser_id={canvasser_id} device_uid={device_uid}")
    print(f"injecting {len(planned)} canvass(es), CanvassID {planned[0][0]}..{planned[-1][0]}" if planned else "nothing to do")
    for cid, van, result, pairs, note, dt in planned:
        print(f"  #{cid} VanID={van} ResultID={result} survey={pairs or '-'} note={note!r} @ {dt}Z")

    if args.dry_run or not planned:
        print("(dry-run: no changes written)" if args.dry_run else "")
        return

    cur = resp_con.cursor()
    for cid, van, result, pairs, note, dt in planned:
        a = addr_for(list_con, van) or {}
        city, zip5 = a.get("City", ""), a.get("Zip5", "")
        cur.execute(
            "INSERT INTO Canvasses (CanvassID,VanID,DateCreated,DeviceUID,ListID,CanvasserID,ResultID,City,Zip5) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (cid, van, dt, device_uid, list_id, canvasser_id, result, city, zip5))
        for q, rid in pairs:
            cur.execute(
                "INSERT INTO CanvassSurveyResponses (SurveyQuestionID,SurveyResponseID,CanvassID,VanID,"
                "DateCreated,DeviceUID,ListID,CanvasserID) VALUES (?,?,?,?,?,?,?,?)",
                (q, rid, cid, van, dt, device_uid, list_id, canvasser_id))
        if a:
            cur.execute(
                "INSERT INTO CanvassAddresses (CanvassID,DeviceUID,ListID,CanvasserID,Action,AptNo,AptType,"
                "City,ContactsAddressID,DateCreated,State,StreetName,StreetNo,StreetNoHalf,StreetPrefix,"
                "StreetSuffix,StreetType,VanID,Zip4,Zip5,Latitude,Longitude) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (cid, device_uid, list_id, canvasser_id, "COPY", a.get("AptNo", ""), a.get("AptType", ""),
                 city, a.get("ContactsAddressID"), dt, a.get("State", ""), a.get("StreetName", ""),
                 a.get("StreetNo"), a.get("StreetNoHalf", ""), a.get("StreetPrefix", ""),
                 a.get("StreetSuffix", ""), a.get("StreetType", ""), van, a.get("Zip4", ""), zip5,
                 a.get("Latitude"), a.get("Longitude")))
        if note:
            cur.execute(
                "INSERT INTO CanvassNotes (NoteText,CanvassID,VanID,DateCreated,DeviceUID,ListID,CanvasserID) "
                "VALUES (?,?,?,?,?,?,?)",
                (note, cid, van, dt, device_uid, list_id, canvasser_id))
        cur.execute("INSERT INTO RecentlyCanvassed (VanID,DateCreated) VALUES (?,?)", (van, dt))

    resp_con.commit()
    print("done. modified:", args.responses_db)


if __name__ == "__main__":
    main()
