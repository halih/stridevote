#!/usr/bin/env python3
"""
van_bridge.py — turn voter-outreach `contacts` into a VAN injection CSV.

Reads contacts logged in the voter-outreach app (voters.db), matches each voter
to a VanID in a downloaded MiniVAN list (by name+address, since the two systems
share no ID), maps outcome/support to VAN result codes + survey responses, and
emits a CSV consumable by inject_canvass.py.

Flow:  voters.db contacts ──► [van_bridge.py] ──► van_upload.csv
                                                     │
                       inject_canvass.py ◄───────────┘  ──► responses DB ──► sync

Usage:
    python3 van_bridge.py --list-db canvass_280640.db --out van_upload.csv \
        [--voters-db /Users/halih/voter-outreach/voters.db] [--turf 4] [--latest-only]

Outcome  -> ResultID:  Talked=14(Canvassed) NotHome=1 LitDrop=21
                       Refused=2 Inaccessible=3 Deceased=4 Moved=5
Support 1..5 -> the candidate-support survey question's responses, matched by
               sort order (1=strongest ... 5=opposed), read live from the list.
"""
import argparse, csv, sqlite3, re, sys

OUTCOME_TO_RESULT = {
    "Talked": 14, "Canvassed": 14, "NotHome": 1, "Refused": 2,
    "Inaccessible": 3, "Deceased": 4, "Moved": 5, "LitDrop": 21, "LitDropped": 21,
}


def norm_first(s):
    return re.sub(r"[^A-Z]", "", (s or "").upper())


def candidate_question(list_con):
    """Return (SurveyQuestionID, {sortorder: SurveyResponseID}) for the
    candidate-support question, or (None, {})."""
    q = list_con.execute(
        "SELECT SurveyQuestionID FROM ScriptSurveyQuestions "
        "WHERE SurveyQuestionType='Candidate' LIMIT 1").fetchone()
    if not q:
        return None, {}
    qid = q[0]
    resp = {so: rid for rid, so in list_con.execute(
        "SELECT SurveyResponseID, SRSortOrder FROM ScriptSurveyQuestionResponses "
        "WHERE SurveyQuestionID=?", (qid,))}
    return qid, resp


def match_vanid(list_con, fname, lname, stno, zip5):
    """Match a voter-outreach voter to a VanID in the list. Returns (vanid|None, status)."""
    rows = list_con.execute(
        "SELECT p.VanID, p.FirstName FROM People p JOIN PeopleAddresses a ON a.VanID=p.VanID "
        "WHERE UPPER(p.LastName)=? AND a.StreetNo=? AND a.Zip5=?",
        ((lname or "").upper(), stno, str(zip5 or ""))).fetchall()
    if not rows:
        return None, "no_address_match"
    # tighten by full first name, then first initial
    full = [r for r in rows if norm_first(r[1]) == norm_first(fname)]
    if len(full) == 1:
        return full[0][0], "matched"
    init = [r for r in rows if norm_first(r[1])[:1] == norm_first(fname)[:1]]
    if len(init) == 1:
        return init[0][0], "matched_initial"
    return None, "ambiguous"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list-db", required=True, help="downloaded MiniVAN list DB (canvass_<id>.db)")
    ap.add_argument("--out", required=True, help="output CSV for inject_canvass.py")
    ap.add_argument("--voters-db", default="/Users/halih/voter-outreach/voters.db")
    ap.add_argument("--turf", type=int, default=None, help="only contacts from this turf_id")
    ap.add_argument("--latest-only", action="store_true", help="only the most recent contact per voter")
    args = ap.parse_args()

    list_con = sqlite3.connect(args.list_db)
    vo = sqlite3.connect(args.voters_db)

    qid, resp_by_sort = candidate_question(list_con)
    valid_results = {r[0] for r in list_con.execute("SELECT ResultID FROM ScriptResults")}
    if qid:
        print(f"candidate-support question: {qid}  support-map: " +
              ", ".join(f"{s}->{resp_by_sort.get(s)}" for s in sorted(resp_by_sort)))
    else:
        print("WARNING: no candidate-support question on this list; support values will be dropped")

    conds, params = [], []
    if args.turf is not None:
        conds.append("c.turf_id=?"); params.append(args.turf)
    if args.latest_only:
        # keep only the newest contact per voter (within the turf scope if given)
        scope = "AND x.turf_id=c.turf_id" if args.turf is not None else ""
        conds.append(f"c.id=(SELECT MAX(id) FROM contacts x WHERE x.voter_id=c.voter_id {scope})")
    where = ("WHERE " + " AND ".join(conds)) if conds else ""
    sql = (f"SELECT c.voter_id, c.outcome, c.support, c.notes, v.fname, v.lname, v.reg_st_num, v.zip "
           f"FROM contacts c JOIN voters v ON v.id=c.voter_id {where} ORDER BY c.id")
    contacts = vo.execute(sql, params).fetchall()

    out_rows, stats = [], {"matched": 0, "matched_initial": 0, "ambiguous": 0,
                            "no_address_match": 0, "bad_outcome": 0}
    for voter_id, outcome, support, notes, fn, ln, stno, zip5 in contacts:
        result = OUTCOME_TO_RESULT.get(outcome)
        if result is None or result not in valid_results:
            stats["bad_outcome"] += 1
            continue
        vanid, status = match_vanid(list_con, fn, ln, stno, zip5)
        if vanid is None:
            stats[status] += 1
            continue
        stats["matched" if status == "matched" else "matched_initial"] += 1
        survey = ""
        if outcome in ("Talked", "Canvassed") and support and qid and resp_by_sort.get(int(support)):
            survey = f"{qid}:{resp_by_sort[int(support)]}"
            result = 14  # a survey response implies Canvassed
        out_rows.append({"VanID": vanid, "ResultID": result,
                         "SurveyResponses": survey, "Note": (notes or "").replace("\n", " ")})

    with open(args.out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["VanID", "ResultID", "SurveyResponses", "Note"])
        w.writeheader()
        w.writerows(out_rows)

    print(f"\ncontacts read: {len(contacts)}  ->  rows written: {len(out_rows)}  -> {args.out}")
    print("match stats:", stats)
    if stats["ambiguous"] or stats["no_address_match"]:
        print("note: unmatched/ambiguous contacts were skipped (not written).")


if __name__ == "__main__":
    main()
