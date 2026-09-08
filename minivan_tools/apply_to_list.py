#!/usr/bin/env python3
"""
apply_to_list.py — take export_list_json.py's output and turn it into a CSV of
canvass results for a DIFFERENT MiniVAN list (one with overlapping voters/doors),
consumable by inject_canvass.py.

The join key is NAME + ADDRESS (last name, house number, zip — same matching
VAN itself uses on paper lists), not VanID: the source JSON is meant to be
portable to any canvassing system, and even between two MiniVAN lists there's
no guarantee VanID round-trips (different data pulls, different tenants). When
a voter's own "van.result_id" survives from a MiniVAN-sourced JSON it's reused
directly (ResultID is a shared VAN enum); otherwise it's derived from the
portable "status_label" by matching the target list's own ScriptResults names.
Survey answers are remapped by matching the portable question/response TEXT
against the target list's own ScriptSurveyQuestions(Responses) — the target
list can run a different script with different SurveyQuestionIDs entirely.

A "Lit Dropped" result (or anything passed via --household-status) is applied
to the WHOLE door on the target list, not just the matched individual — a lit
drop happens at the door, not to one specific person, so every voter sharing
that address on the target list gets the same disposition (no survey/notes,
those stay with whoever the source actually recorded them for).

Usage:
    python3 apply_to_list.py --json export.json --target-list-db canvass_<B>.db \
        --out van_upload.csv

Then, same as van_bridge.py's output:
    python3 inject_canvass.py --responses-db working_<B>_responses.db \
        --list-db canvass_<B>.db --csv van_upload.csv
"""
import argparse, csv, json, re, sqlite3, sys


def norm_first(s):
    return re.sub(r"[^A-Z]", "", (s or "").upper())


def norm(s):
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def door_key(a):
    """Address key identifying a single door (unit-level, not just the building) —
    same fields as the app's own household grouping (StreetNo + street name/type/
    suffix + AptNo + Zip5)."""
    return (str(a["StreetNo"]), norm(a["StreetPrefix"]), norm(a["StreetName"]),
            norm(a["StreetType"]), norm(a["StreetSuffix"]), norm(a["AptNo"]), str(a["Zip5"] or ""))


def load_target(list_db_path):
    con = sqlite3.connect(f"file:{list_db_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row

    people = {}          # (upper(lastname), streetno, zip5) -> [(VanID, firstname), ...]
    vanids_by_door = {}  # door_key -> [VanID, ...] — every voter at that address, any last name
    door_by_vanid = {}   # VanID -> door_key
    for r in con.execute(
        "SELECT p.VanID, p.FirstName, p.LastName, a.StreetNo, a.StreetPrefix, a.StreetName, "
        "a.StreetType, a.StreetSuffix, a.AptNo, a.Zip5 "
        "FROM People p JOIN PeopleAddresses a ON a.VanID = p.VanID"
    ):
        key = (norm(r["LastName"]), str(r["StreetNo"]), str(r["Zip5"] or ""))
        people.setdefault(key, []).append((r["VanID"], r["FirstName"]))
        dk = door_key(r)
        vanids_by_door.setdefault(dk, []).append(r["VanID"])
        door_by_vanid[r["VanID"]] = dk

    results = {norm(r["ResultShortName"]): r["ResultID"] for r in con.execute("SELECT * FROM ScriptResults")}

    questions = list(con.execute("SELECT * FROM ScriptSurveyQuestions"))
    responses = list(con.execute("SELECT * FROM ScriptSurveyQuestionResponses"))
    valid_qids = {q["SurveyQuestionID"] for q in questions}

    return con, people, results, questions, responses, valid_qids, vanids_by_door, door_by_vanid


def household_vanids(van_id, vanids_by_door, door_by_vanid):
    """Every VanID sharing van_id's door on the TARGET list (including van_id itself)."""
    dk = door_by_vanid.get(van_id)
    return vanids_by_door.get(dk, [van_id]) if dk else [van_id]


def match_voter(people, name, address):
    key = (norm(name.get("last")), str(address.get("street_no") or ""), str(address.get("zip5") or ""))
    rows = people.get(key)
    if not rows:
        return None, "no_address_match"
    full = [r for r in rows if norm_first(r[1]) == norm_first(name.get("first"))]
    if len(full) == 1:
        return full[0][0], "matched"
    init = [r for r in rows if norm_first(r[1])[:1] == norm_first(name.get("first"))[:1]]
    if len(init) == 1:
        return init[0][0], "matched_initial"
    return None, "ambiguous"


def resolve_result_id(canvass, results, label_overrides=None):
    """label_overrides: {norm(source status_label): target status_label} for
    dispositions that mean the same thing but are named differently on the
    target list's script (e.g. "Lit Dropped" -> "Left Message/Lit") — supplied
    explicitly via --result-map, never guessed."""
    van = canvass.get("van") or {}
    if van.get("result_id") in set(results.values()):
        return van["result_id"]
    label = canvass.get("status_label")
    if label_overrides:
        label = label_overrides.get(norm(label), label)
    return results.get(norm(label))


def resolve_survey(sr, questions, responses):
    """Match a portable {question, question_short, response} against the target
    list's own script by text. Returns (qid, rid) or None if no match."""
    q_match = None
    for q in questions:
        if sr.get("question_short") and norm(q["SurveyQuestionName"]) == norm(sr["question_short"]):
            q_match = q; break
        if sr.get("question") and norm(q["SurveyQuestionText"]) == norm(sr["question"]):
            q_match = q; break
    if not q_match:
        return None
    qid = q_match["SurveyQuestionID"]
    for r in responses:
        if r["SurveyQuestionID"] != qid:
            continue
        if norm(r["ResponseShortName"]) == norm(sr.get("response")) or \
           norm(r["ResponseVeryShortName"]) == norm(sr.get("response")):
            return qid, r["SurveyResponseID"]
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", required=True, help="export_list_json.py output")
    ap.add_argument("--target-list-db", required=True, help="the OTHER list's canvass_<id>.db")
    ap.add_argument("--out", required=True, help="output CSV for inject_canvass.py")
    ap.add_argument("--stats-json", default=None, help="also write match stats as JSON to this path")
    ap.add_argument("--result-map", action="append", default=[],
                     help='Map a source status_label to a differently-named disposition on the '
                          'target list\'s own script, e.g. --result-map "Lit Dropped=Left Message/Lit". '
                          'Repeatable. Only exact-name matches are auto-resolved otherwise.')
    ap.add_argument("--household-status", action="append", default=[],
                     help='Additional portable status slugs (canvass.status, e.g. "not-home") that '
                          'apply to the whole door/household on the target list, not just the matched '
                          'person. "lit-dropped" is always treated this way — dropping literature is a '
                          'door-level action, not a per-person one. Repeatable.')
    args = ap.parse_args()
    label_overrides = {}
    for pair in args.result_map:
        if "=" not in pair:
            sys.exit(f"ERROR: --result-map must be 'From=To', got {pair!r}")
        src, dst = pair.split("=", 1)
        label_overrides[norm(src.strip())] = dst.strip()
    household_statuses = {"lit-dropped"} | {s.strip().lower() for s in args.household_status}

    data = json.load(open(args.json))
    con, people, results, questions, responses, valid_qids, vanids_by_door, door_by_vanid = \
        load_target(args.target_list_db)

    out_rows = []
    seen_vanids = set()  # each target voter gets at most one row per run
    stats = {"matched": 0, "matched_initial": 0, "ambiguous": 0, "no_address_match": 0,
             "no_result_match": 0, "survey_dropped": 0, "household_expanded": 0}
    for v in data["voters"]:
        c = v.get("canvass")
        if not c:
            continue
        van_id, status = match_voter(people, v["name"], v["address"])
        if van_id is None:
            stats[status] += 1
            continue
        stats["matched" if status == "matched" else "matched_initial"] += 1

        result_id = resolve_result_id(c, results, label_overrides)
        if result_id is None:
            stats["no_result_match"] += 1
            continue

        pairs = []
        for sr in c.get("survey_responses") or []:
            m = resolve_survey(sr, questions, responses)
            if m:
                pairs.append(f"{m[0]}:{m[1]}")
            else:
                stats["survey_dropped"] += 1

        if van_id not in seen_vanids:
            seen_vanids.add(van_id)
            out_rows.append({"VanID": van_id, "ResultID": result_id,
                              "SurveyResponses": ";".join(pairs), "Note": c.get("notes") or ""})

        if (c.get("status") or "").lower() in household_statuses:
            for hh_van_id in household_vanids(van_id, vanids_by_door, door_by_vanid):
                if hh_van_id in seen_vanids:
                    continue
                seen_vanids.add(hh_van_id)
                # only the matched individual's own survey answers/notes apply — the rest of
                # the household just gets the same door-level disposition (e.g. Lit Dropped)
                out_rows.append({"VanID": hh_van_id, "ResultID": result_id, "SurveyResponses": "", "Note": ""})
                stats["household_expanded"] += 1

    with open(args.out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["VanID", "ResultID", "SurveyResponses", "Note"])
        w.writeheader()
        w.writerows(out_rows)

    with_canvass = sum(1 for v in data["voters"] if v.get("canvass"))
    print(f"voters with canvass data: {with_canvass}  -> rows written: {len(out_rows)}  -> {args.out}",
          file=sys.stderr)
    print("match stats:", stats, file=sys.stderr)
    if stats["ambiguous"] or stats["no_address_match"] or stats["survey_dropped"]:
        print("note: unmatched/ambiguous voters were skipped; survey answers with no "
              "matching question/response text on the target list were dropped (disposition kept).",
              file=sys.stderr)

    if args.stats_json:
        with open(args.stats_json, "w") as f:
            json.dump({"with_canvass_data": with_canvass, "rows_written": len(out_rows), **stats}, f)


if __name__ == "__main__":
    main()
