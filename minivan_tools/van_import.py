#!/usr/bin/env python3
"""
van_import.py — pull a MiniVAN list into the voter-outreach app (VAN -> your app).

Two independent operations (use either or both):

  --as-turf "NAME"    Match the list's People to your voters (name+address) and
                      create a turf + turf_voters, so the identical walk list is
                      workable in your app.

  --pull-canvasses    Read canvass results VAN already knows about
                      (PeopleContactHistory + PeopleSurveyQuestionResponses in the
                      list export) and write them into your `contacts` table
                      (reverse of van_bridge's outcome/support mapping).
                      Idempotent: skips contacts that already exist.

Identity: the two systems share no ID, so voters are matched on
last name + house number + zip (+ first name to disambiguate) — ~100% on WA data.

Usage:
    python3 van_import.py --list-db canvass_280640.db --as-turf "Imraan 280640" --pull-canvasses \
        [--voters-db /Users/halih/voter-outreach/voters.db] [--canvasser "VAN import"] [--dry-run]
"""
import argparse, json, sqlite3, re, sys
from datetime import datetime, timezone

RESULT_TO_OUTCOME = {
    "Canvassed": "Talked", "Not Home": "NotHome", "Refused": "Refused",
    "Inaccessible": "Inaccessible", "Deceased": "Deceased", "Moved": "Moved",
    "Lit Dropped": "LitDrop", "Lit Drop": "LitDrop",
}


def norm_first(s):
    return re.sub(r"[^A-Z]", "", (s or "").upper())


def build_vanid_to_voter(list_con, vo):
    """Return {VanID: voter_id} for every matchable person in the list, plus stats."""
    rows = list_con.execute(
        "SELECT p.VanID, p.FirstName, p.LastName, a.StreetNo, a.Zip5 "
        "FROM People p LEFT JOIN PeopleAddresses a ON a.VanID=p.VanID").fetchall()
    mapping, stats = {}, {"matched": 0, "ambiguous": 0, "no_match": 0}
    for vanid, fn, ln, stno, zip5 in rows:
        cands = vo.execute(
            "SELECT id, fname FROM voters WHERE lname=? AND reg_st_num=? AND zip=?",
            ((ln or "").upper(), stno, str(zip5 or ""))).fetchall()
        if not cands:
            stats["no_match"] += 1; continue
        full = [c for c in cands if norm_first(c[1]) == norm_first(fn)]
        init = [c for c in cands if norm_first(c[1])[:1] == norm_first(fn)[:1]]
        pick = full if len(full) == 1 else (init if len(init) == 1 else None)
        if pick:
            mapping[vanid] = pick[0][0]; stats["matched"] += 1
        else:
            stats["ambiguous"] += 1
    return mapping, stats


def iso(dt_text):
    """Best-effort convert a VAN date string to ISO; fall back to as-is."""
    dt_text = (dt_text or "").strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%m/%d/%Y", "%m/%d/%Y %H:%M:%S",
                "%m/%d/%y", "%m/%d/%y %H:%M:%S"):
        try:
            return datetime.strptime(dt_text.strip(), fmt).replace(tzinfo=timezone.utc).isoformat()
        except (ValueError, AttributeError):
            continue
    return dt_text or datetime.now(timezone.utc).isoformat()


def do_turf(vo, list_con, mapping, name, dry):
    voter_ids = sorted(set(mapping.values()))
    list_id = list_con.execute(
        "SELECT ExportSettingValue FROM ExportSettings WHERE ExportSettingName='CurrentListID'").fetchone()
    fj = json.dumps({"source": "van_list", "listId": (list_id[0] if list_id else None), "imported": True})
    print(f"[turf] '{name}': {len(voter_ids)} voters matched")
    if dry:
        print("  (dry-run: turf not created)"); return
    cur = vo.cursor()
    cur.execute("INSERT INTO turfs (name, filter_json, created_at) VALUES (?,?,?)",
                (name, fj, datetime.now(timezone.utc).isoformat()))
    tid = cur.lastrowid
    cur.executemany("INSERT OR IGNORE INTO turf_voters (turf_id, voter_id) VALUES (?,?)",
                    [(tid, vid) for vid in voter_ids])
    vo.commit()
    print(f"  created turf id={tid} with {len(voter_ids)} voters")


def do_pull(vo, list_con, mapping, canvasser, dry):
    # candidate-support question name -> {ResponseShortName/VeryShort: sortorder}
    cq = list_con.execute("SELECT SurveyQuestionID, SurveyQuestionName FROM ScriptSurveyQuestions "
                          "WHERE SurveyQuestionType='Candidate' LIMIT 1").fetchone()
    support_by_text, cq_name = {}, (cq[1] if cq else None)
    if cq:
        for short, vshort, so in list_con.execute(
            "SELECT ResponseShortName, ResponseVeryShortName, SRSortOrder "
            "FROM ScriptSurveyQuestionResponses WHERE SurveyQuestionID=?", (cq[0],)):
            for key in (short, vshort):
                if key:
                    support_by_text[key.strip()] = so

    inserts = []
    # (a) contact-result history
    for vanid, date, typ, result in list_con.execute(
            "SELECT VanID, Date, Type, Result FROM PeopleContactHistory"):
        vid = mapping.get(vanid)
        if not vid:
            continue
        outcome = RESULT_TO_OUTCOME.get((result or "").strip(), (result or "").strip() or "Talked")
        inserts.append((vid, None, outcome, None, f"[VAN import] {typ or ''}".strip(), canvasser, iso(date)))
    # (b) survey responses (candidate-support -> support 1..5)
    for vanid, date, qname, resp in list_con.execute(
            "SELECT VanID, Date, SurveyQuestionName, SurveyQuestionResponse FROM PeopleSurveyQuestionResponses"):
        vid = mapping.get(vanid)
        if not vid:
            continue
        support = support_by_text.get((resp or "").strip()) if (cq_name and qname == cq_name) else None
        note = f"[VAN import] {qname}: {resp}"
        inserts.append((vid, None, "Talked", support, note, canvasser, iso(date)))

    # idempotency: skip rows that already exist (same voter+outcome+created_at)
    fresh = []
    for row in inserts:
        exists = vo.execute("SELECT 1 FROM contacts WHERE voter_id=? AND outcome=? AND created_at=? LIMIT 1",
                            (row[0], row[2], row[6])).fetchone()
        if not exists:
            fresh.append(row)
    print(f"[pull] history+survey rows for matched voters: {len(inserts)}; new (not already in contacts): {len(fresh)}")
    if dry:
        for r in fresh[:8]:
            print("   +", {"voter_id": r[0], "outcome": r[2], "support": r[3], "note": r[4], "at": r[6]})
        print("  (dry-run: nothing written)"); return
    vo.executemany("INSERT INTO contacts (voter_id,turf_id,outcome,support,notes,canvasser,created_at) "
                   "VALUES (?,?,?,?,?,?,?)", fresh)
    vo.commit()
    print(f"  inserted {len(fresh)} contacts")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list-db", required=True)
    ap.add_argument("--voters-db", default="/Users/halih/voter-outreach/voters.db")
    ap.add_argument("--as-turf", metavar="NAME", default=None)
    ap.add_argument("--pull-canvasses", action="store_true")
    ap.add_argument("--canvasser", default="VAN import")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not args.as_turf and not args.pull_canvasses:
        sys.exit("nothing to do: pass --as-turf NAME and/or --pull-canvasses")

    list_con = sqlite3.connect(args.list_db)
    vo = sqlite3.connect(args.voters_db)
    mapping, stats = build_vanid_to_voter(list_con, vo)
    print("identity match:", stats, f"({len(mapping)} VanID->voter_id)")

    if args.as_turf:
        do_turf(vo, list_con, mapping, args.as_turf, args.dry_run)
    if args.pull_canvasses:
        do_pull(vo, list_con, mapping, args.canvasser, args.dry_run)


if __name__ == "__main__":
    main()
