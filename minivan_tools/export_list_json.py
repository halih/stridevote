#!/usr/bin/env python3
"""
export_list_json.py — pull a MiniVAN list's current canvass data off the emulator
and emit it as JSON (name, address, canvass results so far).

Reads both on-device DBs for <ListID> (pulling them via ADB first, unless local
copies are passed in): the List DB for people/addresses/script, and the
Responses DB for this device's own recorded canvasses plus the sync-downloaded
TeamCanvasses (other devices' dispositions).

Per voter, "canvass" is:
  - null                if nobody has canvassed them yet
  - source "recorded"   if THIS device logged the interaction — includes the
                        full picture: disposition, survey answers, notes
  - source "team"       if only known via sync-down from another device —
                        disposition only, per MiniVAN's own data model (see
                        MINIVAN_DB_SCHEMA.md §9: survey/notes never fan out)

Every voter is keyed primarily by NAME + ADDRESS, not VanID — VanID only means
something inside VAN/MiniVAN, whereas name+address is the join key any other
canvassing system (or a different MiniVAN list) can match on. VAN-specific
identifiers (VanID, ResultID, SurveyQuestionID/SurveyResponseID) are still
included, but nested under a "van" key on each voter/canvass, alongside a
portable, text-only rendering at the top level: "status"/"status_label" (a
slugified + human-readable disposition) and "survey_responses" as
question/response text. apply_to_list.py re-resolves the text back to another
MiniVAN list's own IDs by matching labels (a different list can use a
different script, so raw IDs from this list won't exist there).

Usage:
    python3 export_list_json.py <ListID> [--list-db PATH --responses-db PATH]

Prints JSON to stdout.
"""
import argparse, json, os, re, sqlite3, subprocess, sys, tempfile

PKG = "com.voteractivationnetwork.minivan"


def adb_bin():
    sdk = os.environ.get("ANDROID_HOME", "/opt/homebrew/share/android-commandlinetools")
    if subprocess.run(["which", "adb"], capture_output=True).returncode == 0:
        return "adb"
    return f"{sdk}/platform-tools/adb"


def pull_dbs(list_id, workdir):
    adb = adb_bin()
    subprocess.run([adb, "root"], capture_output=True)
    subprocess.run([adb, "shell", "am", "force-stop", PKG], capture_output=True, check=True)
    list_db = os.path.join(workdir, f"canvass_{list_id}.db")
    resp_db = os.path.join(workdir, f"canvass_{list_id}_responses.db")
    for remote, local in ((f"canvass_{list_id}.db", list_db), (f"canvass_{list_id}_responses.db", resp_db)):
        r = subprocess.run([adb, "exec-out", f"cat /data/data/{PKG}/files/{remote}"],
                            capture_output=True, check=True)
        if not r.stdout:
            sys.exit(f"ERROR: /data/data/{PKG}/files/{remote} is empty or missing "
                      f"(is list {list_id} actually the active, downloaded list?)")
        with open(local, "wb") as f:
            f.write(r.stdout)
    return list_db, resp_db


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") if s else None


def full_address(a):
    parts = [a.get("StreetNo"), a.get("StreetPrefix"), a.get("StreetName"),
              a.get("StreetType"), a.get("StreetSuffix")]
    street = " ".join(str(p) for p in parts if p)
    if a.get("AptNo"):
        street += f" #{a['AptNo']}"
    city_line = ", ".join(p for p in (a.get("City"), a.get("State")) if p)
    if a.get("Zip5"):
        city_line = f"{city_line} {a['Zip5']}".strip()
    return ", ".join(p for p in (street, city_line) if p)


def build_json(list_db_path, resp_db_path):
    list_db = sqlite3.connect(f"file:{list_db_path}?mode=ro", uri=True)
    list_db.row_factory = sqlite3.Row
    resp_db = sqlite3.connect(f"file:{resp_db_path}?mode=ro", uri=True)
    resp_db.row_factory = sqlite3.Row

    settings = {r["ExportSettingName"]: r["ExportSettingValue"]
                for r in list_db.execute("SELECT ExportSettingName, ExportSettingValue FROM ExportSettings")}

    result_names = {r["ResultID"]: r["ResultShortName"] for r in list_db.execute("SELECT * FROM ScriptResults")}

    questions = {r["SurveyQuestionID"]: dict(r) for r in list_db.execute("SELECT * FROM ScriptSurveyQuestions")}
    responses = {}
    for r in list_db.execute("SELECT * FROM ScriptSurveyQuestionResponses"):
        responses[(r["SurveyQuestionID"], r["SurveyResponseID"])] = dict(r)

    addresses = {r["VanID"]: dict(r) for r in list_db.execute("SELECT * FROM PeopleAddresses")}

    phones_by_van = {}
    try:
        for r in list_db.execute("SELECT VanID, Phone FROM PeoplePhones WHERE Phone IS NOT NULL AND Phone<>''"):
            phones_by_van.setdefault(r["VanID"], []).append(r["Phone"])
    except sqlite3.OperationalError:
        pass

    emails_by_van = {}
    try:
        for r in list_db.execute("SELECT VanID, Email FROM PeopleEmails WHERE Email IS NOT NULL AND Email<>''"):
            emails_by_van.setdefault(r["VanID"], []).append(r["Email"])
    except sqlite3.OperationalError:
        pass

    # this device's own recorded canvasses: latest per VanID, plus its notes/survey answers
    own = {}
    for r in resp_db.execute("SELECT * FROM Canvasses ORDER BY DateCreated ASC"):
        own[r["VanID"]] = dict(r)  # keep walking forward -> ends up latest
    own_notes = {}
    for r in resp_db.execute("SELECT VanID, NoteText, DateCreated FROM CanvassNotes ORDER BY DateCreated ASC"):
        own_notes[r["VanID"]] = r["NoteText"]
    own_survey = {}
    for r in resp_db.execute("SELECT * FROM CanvassSurveyResponses"):
        own_survey.setdefault(r["VanID"], []).append(dict(r))

    # other devices' sync-downed dispositions: latest per VanID
    team = {}
    for r in resp_db.execute("SELECT * FROM TeamCanvasses ORDER BY DateCreated ASC"):
        team[r["VanID"]] = dict(r)

    # Name + address is the portable join key for ANY canvassing system (this system's
    # VanID is meaningless outside VAN/MiniVAN). Every value that's specific to VAN's own
    # data model (VanID, ResultID, SurveyQuestionID/SurveyResponseID) is therefore kept
    # under a "van" sub-object, alongside a portable, text-only rendering at the top level
    # (status slug + label, question/response text) that any other system can consume
    # without knowing VAN's codes.
    voters = []
    for p in list_db.execute("SELECT * FROM People"):
        van_id = p["VanID"]
        addr = addresses.get(van_id, {})
        canvass = None
        if van_id in own:
            c = own[van_id]
            result_id = c["ResultID"]
            result_name = result_names.get(result_id)
            survey_out, van_survey_out = [], []
            for sr in own_survey.get(van_id, []):
                q = questions.get(sr["SurveyQuestionID"], {})
                resp = responses.get((sr["SurveyQuestionID"], sr["SurveyResponseID"]), {})
                response_name = resp.get("ResponseShortName") or resp.get("ResponseVeryShortName")
                survey_out.append({
                    "question": q.get("SurveyQuestionText") or q.get("SurveyQuestionName"),
                    "question_short": q.get("SurveyQuestionName"),
                    "response": response_name,
                })
                van_survey_out.append({
                    "question_id": sr["SurveyQuestionID"],
                    "response_id": sr["SurveyResponseID"],
                })
            canvass = {
                "status": slugify(result_name),
                "status_label": result_name,
                "date": c["DateCreated"],
                "source": "recorded",
                "notes": own_notes.get(van_id),
                "survey_responses": survey_out,
                "van": {"result_id": result_id, "survey_responses": van_survey_out},
            }
        elif van_id in team:
            t = team[van_id]
            result_id = t["ResultID"]
            result_name = result_names.get(result_id)
            canvass = {
                "status": slugify(result_name),
                "status_label": result_name,
                "date": t["DateCreated"],
                # dispositions only: MiniVAN's own sync model never fans survey answers/notes
                # out to other devices, so there is nothing more to report for a "team" result.
                "source": "team",
                "notes": None,
                "survey_responses": [],
                "van": {"result_id": result_id, "survey_responses": []},
            }

        phone_list = list(phones_by_van.get(van_id, []))
        home = p["HomePhone"] if "HomePhone" in p.keys() else None
        likely = p["LikelyParty"] if "LikelyParty" in p.keys() else None
        voters.append({
            "name": {"first": p["FirstName"], "middle": p["MiddleName"], "last": p["LastName"]},
            "address": {
                "street_no": addr.get("StreetNo"), "street_prefix": addr.get("StreetPrefix"),
                "street_name": addr.get("StreetName"), "street_type": addr.get("StreetType"),
                "street_suffix": addr.get("StreetSuffix"), "apt_no": addr.get("AptNo"),
                "city": addr.get("City"), "state": addr.get("State"), "zip5": addr.get("Zip5"),
                "full": full_address(addr) if addr else p["vAddress"],
                "lat": addr.get("Latitude") or (p["Latitude"] if "Latitude" in p.keys() else None),
                "lng": addr.get("Longitude") or (p["Longitude"] if "Longitude" in p.keys() else None),
            },
            "phones": phone_list,
            "emails": list(emails_by_van.get(van_id, [])),
            "likely_party": likely,
            "home_phone": home,
            "canvass": canvass,
            "van": {"van_id": van_id},
        })

    door_keys = {
        (a.get("StreetNo"), a.get("StreetName"), a.get("AptNo"), a.get("City"), a.get("Zip5"))
        for a in addresses.values()
    }

    team_canvasses = []
    for van_id, t in team.items():
        result_id = t["ResultID"]
        team_canvasses.append({
            "vanId": van_id,
            "resultId": result_id,
            "statusLabel": result_names.get(result_id),
            "dateCreated": t["DateCreated"],
        })

    return {
        "list": {
            "list_id": int(settings.get("CurrentListID", 0)),
            "name": settings.get("CurrentListName"),
            "people_count": len(voters),
            "door_count": len(door_keys),
            "printed_list_number": settings.get("PrintedListNumber") or settings.get("CurrentListName"),
        },
        "voters": voters,
        "teamCanvasses": team_canvasses,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("list_id", type=int)
    ap.add_argument("--list-db", default=None, help="already-pulled list DB (skip ADB pull)")
    ap.add_argument("--responses-db", default=None, help="already-pulled responses DB (skip ADB pull)")
    args = ap.parse_args()

    if args.list_db and args.responses_db:
        data = build_json(args.list_db, args.responses_db)
    else:
        with tempfile.TemporaryDirectory() as tmp:
            list_db, resp_db = pull_dbs(args.list_id, tmp)
            data = build_json(list_db, resp_db)

    json.dump(data, sys.stdout, indent=2)


if __name__ == "__main__":
    main()
