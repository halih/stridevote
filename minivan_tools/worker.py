#!/usr/bin/env python3
"""
worker.py — poll StrideVote MiniVAN job APIs and drive the local emulator.

Never run ADB from Next.js. This sidecar owns download / export / inject / sync.

Env:
  STRIDEVOTE_URL          default http://localhost:3000
  MINIVAN_WORKER_TOKEN    must match StrideVote MINIVAN_WORKER_TOKEN
  MINIVAN_POLL_SECONDS    default 5

Usage:
  python3 worker.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.environ.get("STRIDEVOTE_URL", "http://localhost:3000").rstrip("/")
TOKEN = os.environ.get("MINIVAN_WORKER_TOKEN", "")
POLL = float(os.environ.get("MINIVAN_POLL_SECONDS", "5"))


def api(method: str, path: str, body: dict | None = None) -> dict:
    if not TOKEN:
        sys.exit("ERROR: set MINIVAN_WORKER_TOKEN")
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            return json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        err_body = e.read().decode(errors="replace")
        hint = ""
        if e.code == 500 and not err_body.strip():
            hint = (
                " (empty 500 — usually a stale Next.js process; restart `npm run dev` "
                "after `npx prisma generate` / migrate)"
            )
        raise RuntimeError(f"{method} {path} -> {e.code}: {err_body}{hint}") from e


def run_py(script: str, args: list[str], check: bool = True) -> subprocess.CompletedProcess:
    r = subprocess.run(
        [sys.executable, os.path.join(HERE, script), *args],
        cwd=HERE,
        capture_output=True,
        text=True,
        check=False,
    )
    if check and r.returncode != 0:
        detail = (r.stderr or r.stdout or "").strip() or f"exit {r.returncode}"
        raise RuntimeError(f"{script} failed: {detail}")
    return r


def download_printed(printed: str) -> int:
    r = run_py("download_list.py", [printed])
    list_id = int(r.stdout.strip().splitlines()[-1])
    return list_id


def export_json(list_id: int) -> dict:
    r = run_py("export_list_json.py", [str(list_id)])
    return json.loads(r.stdout)


def people_payload(printed: str, data: dict) -> dict:
    people = []
    for v in data.get("voters", []):
        addr = v.get("address") or {}
        name = v.get("name") or {}
        van = (v.get("van") or {}).get("van_id")
        if van is None:
            continue
        people.append({
            "vanId": int(van),
            "firstName": name.get("first"),
            "middleName": name.get("middle"),
            "lastName": name.get("last"),
            "streetNo": None if addr.get("street_no") is None else str(addr.get("street_no")),
            "streetPrefix": addr.get("street_prefix"),
            "streetName": addr.get("street_name"),
            "streetType": addr.get("street_type"),
            "streetSuffix": addr.get("street_suffix"),
            "aptNo": None if addr.get("apt_no") is None else str(addr.get("apt_no")),
            "city": addr.get("city"),
            "state": addr.get("state"),
            "zip5": None if addr.get("zip5") is None else str(addr.get("zip5")),
            "fullAddress": addr.get("full"),
            "lat": addr.get("lat"),
            "lng": addr.get("lng"),
            "phones": v.get("phones") or [],
            "emails": v.get("emails") or [],
            "likelyParty": v.get("likely_party"),
            "homePhone": v.get("home_phone"),
        })
    return {
        "printedListNumber": printed,
        "listId": int((data.get("list") or {}).get("list_id") or 0),
        "listName": (data.get("list") or {}).get("name"),
        "people": people,
    }


def remap_support_survey(list_db: str, data: dict) -> dict:
    """Map numeric Support 1–5 responses to this list's candidate SRSortOrder IDs."""
    import sqlite3
    con = sqlite3.connect(f"file:{list_db}?mode=ro", uri=True)
    q = con.execute(
        "SELECT SurveyQuestionID FROM ScriptSurveyQuestions "
        "WHERE SurveyQuestionType='Candidate' LIMIT 1"
    ).fetchone()
    if not q:
        return data
    qid = q[0]
    by_sort = {
        so: rid
        for rid, so in con.execute(
            "SELECT SurveyResponseID, SRSortOrder FROM ScriptSurveyQuestionResponses "
            "WHERE SurveyQuestionID=?",
            (qid,),
        )
    }
    qrow = con.execute(
        "SELECT SurveyQuestionName, SurveyQuestionText FROM ScriptSurveyQuestions "
        "WHERE SurveyQuestionID=?",
        (qid,),
    ).fetchone()
    qname, qtext = (qrow[0] if qrow else "Support"), (qrow[1] if qrow else "Candidate support")
    resp_names = {
        rid: (short or vshort)
        for rid, short, vshort in con.execute(
            "SELECT SurveyResponseID, ResponseShortName, ResponseVeryShortName "
            "FROM ScriptSurveyQuestionResponses WHERE SurveyQuestionID=?",
            (qid,),
        )
    }

    for v in data.get("voters", []):
        c = v.get("canvass")
        if not c:
            continue
        new_srs = []
        for sr in c.get("survey_responses") or []:
            if (sr.get("question_short") or "").lower() == "support" and str(sr.get("response", "")).isdigit():
                sort = int(sr["response"])
                rid = by_sort.get(sort)
                if rid:
                    new_srs.append({
                        "question": qtext,
                        "question_short": qname,
                        "response": resp_names.get(rid) or str(sort),
                    })
                continue
            new_srs.append(sr)
        c["survey_responses"] = new_srs
    return data


def handle_import(job: dict) -> None:
    payload = job.get("payload") or {}
    printed = payload.get("printedListNumber")
    if not printed:
        raise RuntimeError("import_list missing printedListNumber")
    list_id = download_printed(printed)
    data = export_json(list_id)
    body = people_payload(printed, data)
    api("POST", f"/api/minivan/jobs/{job['id']}/apply-import", body)


def handle_pull(job: dict) -> None:
    payload = job.get("payload") or {}
    printed = payload.get("printedListNumber") or (job.get("list") or {}).get("sourceRef")
    if not printed:
        raise RuntimeError("pull_canvass missing printedListNumber")
    # Force re-download so TeamCanvasses refreshes from VAN (wipes local write-side).
    r = run_py("download_list.py", [printed, "--force"])
    list_id = int(r.stdout.strip().splitlines()[-1])
    data = export_json(list_id)
    # Emulator is never the recording device — TeamCanvasses only.
    team = data.get("teamCanvasses") or []
    api("POST", f"/api/minivan/jobs/{job['id']}/apply-pull", {"teamCanvasses": team})


def handle_push(job: dict) -> None:
    payload = job.get("payload") or {}
    printed = payload.get("printedListNumber") or (job.get("list") or {}).get("sourceRef")
    if not printed:
        raise RuntimeError("push_canvass missing printedListNumber")
    push = api("GET", f"/api/minivan/jobs/{job['id']}/push-payload")
    data = push.get("data")
    if not data:
        raise RuntimeError(push.get("error") or "empty push payload")

    list_id = download_printed(printed)
    with tempfile.TemporaryDirectory() as tmp:
        json_path = os.path.join(tmp, "push.json")
        # Remap numeric support onto this list's script before apply_and_sync.
        list_db = os.path.join(tmp, f"canvass_{list_id}.db")
        # pull list db for remap
        import download_list as dl
        dl.adb("root", check=False)
        dl.adb_shell(f"am force-stop {dl.PKG}")
        remote = f"/data/data/{dl.PKG}/files/canvass_{list_id}.db"
        raw = subprocess.run(
            [dl.ADB, "exec-out", f"cat {remote}"], capture_output=True
        )
        if not raw.stdout:
            raise RuntimeError(f"missing on-device list DB for {list_id}")
        with open(list_db, "wb") as f:
            f.write(raw.stdout)
        data = remap_support_survey(list_db, data)
        with open(json_path, "w") as f:
            json.dump(data, f)

        r = run_py("apply_and_sync.py", [str(list_id), "--json", json_path], check=False)
        if r.returncode != 0:
            raise RuntimeError(r.stderr.strip() or r.stdout.strip() or "apply_and_sync failed")
        summary = {}
        try:
            summary = json.loads(r.stdout.strip().splitlines()[-1])
        except Exception:
            summary = {"raw": r.stdout.strip()}
        api("POST", f"/api/minivan/jobs/{job['id']}/complete", {"result": summary})


def process_job(job: dict) -> None:
    typ = job.get("type")
    print(f"claimed {job['id']} type={typ}", flush=True)
    if typ == "import_list":
        handle_import(job)
    elif typ == "pull_canvass":
        handle_pull(job)
    elif typ == "push_canvass":
        handle_push(job)
    else:
        raise RuntimeError(f"unknown job type {typ}")
    print(f"done {job['id']}", flush=True)


def main() -> None:
    print(f"MiniVAN worker polling {BASE} every {POLL}s", flush=True)
    while True:
        try:
            resp = api("POST", "/api/minivan/claim", {})
            job = resp.get("job")
            if not job:
                time.sleep(POLL)
                continue
            try:
                process_job(job)
            except Exception as e:
                print(f"FAIL {job.get('id')}: {e}", file=sys.stderr, flush=True)
                try:
                    api("POST", f"/api/minivan/jobs/{job['id']}/fail", {"error": str(e)})
                except Exception as fe:
                    print(f"could not report failure: {fe}", file=sys.stderr, flush=True)
        except Exception as e:
            print(f"poll error: {e}", file=sys.stderr, flush=True)
            time.sleep(POLL)


if __name__ == "__main__":
    main()
