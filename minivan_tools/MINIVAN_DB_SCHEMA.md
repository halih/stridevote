# MiniVAN Local Database Schema Reference

Reference for the two SQLite databases MiniVAN creates on-device when a list is
downloaded. Written for both humans and AI agents working with MiniVAN data
(export/analysis, and writing canvass results back for sync).

- **Source:** MiniVAN for Android **9.2.4** (build 371), `DataVersion 2.0.0.0`
- **Observed lists:** `280640` — "Imraan Primary Script" (127 people); `277901`
  ("List 57166669-86760", 178 people) used for the cross-device sync tests in §9
- **On-device location:** `/data/data/com.voteractivationnetwork.minivan/files/`
  - `canvass_<ListID>.db` — the **List DB** (read side: the walk list)
  - `canvass_<ListID>_responses.db` — the **Responses DB** (write side: canvass results pending sync)
- **Journal mode:** classic rollback journal (`*-journal`), **not** WAL. Safe to
  edit while the app is force-stopped.
- **iOS note:** the iOS app uploads a packaged DB named `MiniVANULNew.db.gz`; its
  table layout matches the Responses DB below. This doc reflects the Android on-device stores.

---

## 1. Sync model (how the two DBs relate)

```
                 download list                          tap "Sync"
   VAN  ────────────────────────►  canvass_<id>.db   (read-only walk list)
                                          │
                                    canvasser works
                                          │
                                          ▼
                                 canvass_<id>_responses.db
                                 (Canvasses + Canvass* rows)
                                          │
                    app gzips + HMAC-signs (embedded key) + POSTs
                                          ▼
   VAN  ◄──────────────────────────────────────────────────────────
```

- The **List DB** is a read-only snapshot of voters + the canvassing script.
- Every interaction the canvasser records is written to the **Responses DB**.
- On Sync, MiniVAN packages the Responses DB, gzips it, computes an HMAC `hash`,
  and uploads it with a signed request. **The signing key lives in the app**, so
  rows written into the Responses DB by any means are uploaded as authentic once
  the genuine app syncs. There is no per-row "synced" flag (rows persist locally
  after upload — see §8.2).
- **Sync is bidirectional, and the two directions carry different data (see §9):**
  the **upload** is only the *interactions pending since the last sync* — a small
  per-interaction delta, **not** the whole Responses DB. The **download** side pulls
  the list's entire canvass-result set (every device's dispositions) from a
  `teamCanvasses` endpoint into the Responses DB `TeamCanvasses` table — but that
  fan-out is **disposition-only** (no survey answers, notes, or activist codes).

---

## 2. Shared conventions

Most write-side (`Canvass*`) tables repeat this column block. Populate all of it
for rows to look app-authentic:

| Column | Type | Meaning | Example |
|---|---|---|---|
| `VanID` | INTEGER | Voter's VAN ID (FK → `People.VanID`) | `2086019` |
| `CanvassID` | INTEGER | Groups rows from one interaction. PK in `Canvasses`; sequential, **client-assigned**, starts at 1 | `1` |
| `DateCreated` | TEXT | **UTC** `YYYY-MM-DD HH:MM:SS` | `2026-07-05 08:58:03` |
| `DeviceUID` | TEXT | Per-device/install id | `Android-14-Device-sdk_gphone64_arm64-6289c7dd469258a7` |
| `ListID` | INTEGER | The list id | `280640` |
| `CanvasserID` | INTEGER | Who canvassed (= `ExportSettings.CanvasserID`) | `132521958` |
| `Latitude`/`Longitude`/`GeocodeAccuracy` | REAL | GPS at time of contact; NULL when unavailable | NULL |

**Key constants** come from `List DB → ExportSettings` (see §3): `CanvasserID`,
`CurrentListID`, `VANSystemID`, `DefaultScriptID`, `ContactTypeID`, `MiniVANTeamID`,
`MiniVanCampaignID`.

---

## 3. LIST DB — `canvass_<ListID>.db` (read side)

37 tables. Grouped by purpose below; row counts from list 280640.

### 3.1 Configuration / metadata
| Table | Rows | Purpose |
|---|---|---|
| `ExportSettings` | 51 | **Name/value config for the whole list** (see key rows below) |
| `SystemInfo` | 2 | `DatabaseCode`, `System Name` (often blank) |
| `android_metadata` | 1 | SQLite locale |

**Important `ExportSettings` values (list 280640):**

| Name | Value | Notes |
|---|---|---|
| `CurrentListID` | `280640` | list id used in file names + all rows |
| `CurrentListName` | `List 57429198-80406` | |
| `ListUID` | `20260701210152-668237-2796115` | unique export id |
| `DataVersion` | `2.0.0.0` | schema version |
| `VANSystemID` | `500680` | committee/system id |
| `CanvasserID` | `132521958` | the logged-in canvasser (= POST `userId`) |
| `ContactTypeID` | `2` | contact method (2 = door/walk) |
| `DefaultScriptID` | `762505` | the canvassing script |
| `TimeZoneID` / `TimeZoneOffset` | `Pacific Standard Time` / `-480` | display TZ; `DateCreated` is still stored UTC |
| `MiniVANTeamID` | `150335` | |
| `MiniVanCampaignID` | `4304` | |
| `TenantUri` | `ngpvan://van/DNC/DNCWA/0/125825` | tenant routing |
| `ExpirationDate` | `20260929` | list expiry |
| `AddPhones`/`EditPhones`/`AddEmails`/`EditEmails` | `1` | edit permissions surfaced in-app |
| `IsAutoSyncEnabled` | `1` | auto-sync toggle |
| `MemberCodesDoNotWalk` | `M,H` | member codes to skip |

### 3.2 People & contact data
| Table | Rows | Purpose |
|---|---|---|
| `People` | 127 | **The walk list.** One row per voter. See column decode below. |
| `PeopleAddresses` | 127 | Structured address per voter (source for `CanvassAddresses`) |
| `PeoplePhones` | 269 | Phones: `VanID, Date, PhoneTypeID, Phone, PhoneExt` |
| `PeopleEmails` | 0 | Emails: `VanID, Date, Email, Preferred` |
| `PeopleContactHistory` | 0 | Prior contacts: `VanID, Date, Type, Input, Result, Committee` |
| `PeopleNotes` | 0 | Existing notes: `VanID, Date, NoteText` |
| `PeopleActivistCodes` | 33 | Existing activist codes: `VanID, Date, ActivistCodeType, ActivistCodeName` |
| `PeopleSurveyQuestionResponses` | 2 | Prior survey answers: `VanID, Date, SurveyQuestionName, SurveyQuestionResponse` |
| `VHouseholds` | 80 | Household roll-ups: `VHHID, StreetNo, FullStreetName, FullAddress, VHHCount, lat/long` |

**`People` column decode.** Real fields plus 14 pre-rendered display columns
(`LBL0..LBL13`) whose meaning is defined by `LayoutSettings`:

| Column | Meaning |
|---|---|
| `LBL0` | Name (`Last, First Middle`) |
| `LBL1` | Voting Address |
| `LBL2` | Source File Sex |
| `LBL3` | Age |
| `LBL4` | Likely Party |
| `LBL5` | Phone Numbers |
| `LBL6` | VF VANID |
| `LBL7` | Polling Loc |
| `LBL8` | Polling Address |
| `LBL9` | City |
| `LBL10` | Polling City |
| `LBL11` | EV (early voting) Location |
| `LBL12` | EV Address |
| `LBL13` | EV City |

Real (non-display) `People` columns include: `FirstName, LastName, MiddleName,
vAddress, Sex, Age, LikelyParty, VanID, PollingLocation, PollingAddress,
PollingCity, EarlyVotingLocationName/Address/City, VAddressID, HomePhone,
DefaultScriptID, Voted, DateModified, VHHID, MHHID, NamePronunciation, Party,
NoWalk, DWID, Latitude, Longitude, GeocodeAccuracy, ListID, CanvasserID,
CanvassID, DeviceUID`.

**`PeopleAddresses` columns:** `VanID, ContactsAddressID, StreetNo, StreetNoHalf,
StreetPrefix, StreetName, StreetType, StreetSuffix, AptType, AptNo, Building,
Locality, County, Province, City, State, Zip5, Zip4, PostalCode, Latitude,
Longitude, GeocodeAccuracy, IsBadAddress, DateModified`. `ContactsAddressID` is
the join key copied into `CanvassAddresses`.

### 3.3 Script (the questions & result codes shown while canvassing)
| Table | Rows | Purpose |
|---|---|---|
| `ScriptsV2` | 1 | The script: `ScriptID, ScriptName, ScriptDescription` (`762505` "Imraan Primary Script") |
| `ScriptElementsV2` | 6 | Ordered script steps: text blocks + survey questions (`SortOrder`, `ScriptTextID`, `SurveyQuestionID`) |
| `ScriptElements` | 6 | v1 equivalent of the above |
| `ScriptTexts` | 4 | `ScriptTextID, ScriptText, ScriptTextFormatted` (spiel shown to canvasser) |
| `ScriptSurveyQuestions` | 2 | **Survey questions** — see reference below |
| `ScriptSurveyQuestionResponses` | 6 | **Valid answers per question** — see reference below |
| `ScriptResults` | 7 | **Result/disposition codes** — see reference below |
| `ScriptResultsV2` | 7 | Per-script variant of result codes |
| `ScriptActivistCodes` | 0 | Activist codes available to apply |
| `ScriptElementsBranchings` | 0 | Conditional script branching |
| `ScriptEvents*` (Events/Shifts/Roles/Locations/Statuses/TypesEventStatuses) | 0 | Event-signup elements (unused here) |

### 3.4 Lookups & UI layout
| Table | Rows | Purpose |
|---|---|---|
| `PhoneTypes` | 6 | `PhoneTypeID, PhoneTypeName, SortOrder` |
| `PaymentTypes` | 3 | Contribution payment types |
| `OnlineFormsRecurrenceTypes` / `OnlineFormsRecurringDuration` | 7 / 4 | Recurring-donation options |
| `Canvassers` | 1 | `CanvasserID, CanvasserFirstName, CanvasserLastName, VanID, VanIDTenantURI` |
| `LayoutSettings` | 14 | Maps `LBL0..13` → display names (voter detail page) |
| `JobsLayoutSettings` | 0 | Labor/union list layout |
| `Form` | 6 | Add/edit-person form definition |
| `Videos` | 0 | Training/canvasser videos |

---

## 4. RESPONSES DB — `canvass_<ListID>_responses.db` (write side)

18 tables; empty on a fresh download. Every recorded interaction adds rows here.
**These are what get uploaded on Sync.** All share the column block from §2.

### 4.1 Core (used for a standard canvass)
| Table | Purpose | Distinctive columns |
|---|---|---|
| **`Canvasses`** | **One row per interaction.** The anchor everything else joins to. | `CanvassID` **(PK)**, `ResultID`, `City`, `Zip5`, `CampaignID`, `OfficeCode` |
| **`CanvassSurveyResponses`** | One row per survey answer given | `SurveyQuestionID`, `SurveyResponseID` |
| **`CanvassAddresses`** | The address contacted (copied from `PeopleAddresses`) | `Action` (`'COPY'`), `ContactsAddressID`, full street/city/zip fields |
| **`CanvassNotes`** | Free-text note left on the voter | `NoteText` |
| **`CanvassActivistCodes`** | Activist code applied | `ActivistCodeID`, `ResponseID` (default 1) |
| `RecentlyCanvassed` | **Local UI only** (recent list). `VanID, DateCreated`. Not part of sync. | — |

`Canvasses` full columns: `CanvassID, VanID, DateCreated, DeviceUID, ListID,
CanvasserID, ResultID, Latitude, Longitude, GeocodeAccuracy, CampaignID,
OfficeCode, City, Zip5`.

`CanvassAddresses` full columns: `CanvassID, DeviceUID, ListID, CanvasserID,
Action, AptNo, AptType, City, ContactsAddressID, DateCreated, State, StreetName,
StreetNo, StreetNoHalf, StreetPrefix, StreetSuffix, StreetType, VanID, Zip4,
Zip5, Latitude, Longitude, GeocodeAccuracy, County, Province, Locality,
PostalCode, Building, SubBuilding, SubRoad`.

### 4.2 Other capture types (present but unused for a basic canvass)
| Table | Purpose |
|---|---|
| `CanvassPhones` | Add/edit a phone: `Phone, PhoneTypeID, Action, ...` |
| `CanvassEmails` | Add/edit an email: `Email, Action, ...` |
| `CanvassContributions` | Donations: `PaymentTypeID, Amount, RecurrenceTypeId, OnlineForms...` |
| `CanvassPaymentTypes` | Payment method chosen |
| `CanvassEventResponses` | Event sign-ups: `EventStatusID, EventID, EventRoleID, EventShiftID, ...` |
| `CanvassVideos` | Video watch tracking: `VideoUrl, VideoProgress` |
| `CanvassOrganizationContacts` / `CanvassOrganizationContactsJobs` | Labor/union org contacts |
| `CanvassGeocodes` | Standalone GPS breadcrumbs: `CanvasserID, DateCreated, DeviceUID, ListID, lat/long` |
| `TeamCanvasses` | **Sync-DOWN store, not a local write.** Populated from the server's `teamCanvasses` endpoint on sync with the list's *entire* canvass-result set (every device's dispositions). Columns: `VanID, ResultID, DateCreated, MiniVANExportID` — **disposition only, no survey/notes.** This is what makes another canvasser's results visible on your device. See §9. |
| `ExportSettings` | Mirror of config (empty on device) |
| `android_metadata` | SQLite locale |

### 4.3 Indexes
`Canvasses(VanID, ResultID)`, `Canvasses(ResultID)`, and on `TeamCanvasses` a
unique index `(VanID, ResultID, DateCreated, MiniVanExportID)`.

---

## 5. Reference values (list 280640)

### Result / disposition codes — `ScriptResults`
| ResultID | Name |
|---|---|
| 14 | Canvassed *(auto-applied when a survey response is recorded)* |
| 1 | Not Home |
| 2 | Refused |
| 3 | Inaccessible |
| 4 | Deceased |
| 5 | Moved |
| 21 | Lit Dropped |

### Survey questions — `ScriptSurveyQuestions`
| SurveyQuestionID | Name | Text | Type |
|---|---|---|---|
| 734728 | Imraan Support | Will you be supporting Imraan in the upcoming election? | Candidate |
| 734730 | Yard Sign | Would you like a yard sign? | Action |

### Survey responses — `ScriptSurveyQuestionResponses`
| SurveyQuestionID | SurveyResponseID | Short name |
|---|---|---|
| 734728 | 2947418 | 1. |
| 734728 | 2947419 | 2. Likely Support |
| 734728 | 2947420 | 3. Undecided |
| 734728 | 2947421 | 4. Likely Opposed |
| 734728 | 2947422 | 5. 100% Opposed |
| 734730 | 2947428 | Yes |

---

## 6. Worked example — one recorded interaction

Canvasser marks **Cheryl Bortz (VanID 2086019)** as *Canvassed* and answers
*Imraan Support = 3. Undecided*. The app writes:

```sql
-- Canvasses
INSERT INTO Canvasses
 (CanvassID,VanID,DateCreated,DeviceUID,ListID,CanvasserID,ResultID,City,Zip5)
 VALUES (1, 2086019, '2026-07-05 08:58:03',
         'Android-14-Device-sdk_gphone64_arm64-6289c7dd469258a7',
         280640, 132521958, 14, 'Shoreline', '98133');

-- CanvassSurveyResponses (Q 734728 -> A 2947420 = "3. Undecided")
INSERT INTO CanvassSurveyResponses
 (SurveyQuestionID,SurveyResponseID,CanvassID,VanID,DateCreated,DeviceUID,ListID,CanvasserID)
 VALUES (734728, 2947420, 1, 2086019, '2026-07-05 08:58:03',
         'Android-14-Device-sdk_gphone64_arm64-6289c7dd469258a7', 280640, 132521958);

-- CanvassAddresses (Action=COPY, fields from PeopleAddresses)
INSERT INTO CanvassAddresses
 (CanvassID,DeviceUID,ListID,CanvasserID,Action,City,ContactsAddressID,DateCreated,
  State,StreetName,StreetNo,StreetPrefix,StreetType,VanID,Zip4,Zip5,Latitude,Longitude)
 VALUES (1,'Android-14-...',280640,132521958,'COPY','Shoreline',760999381,
         '2026-07-05 08:58:03','WA','161st',766,'N','Pl',2086019,'5671','98133',
         47.746556,-122.349487);

-- RecentlyCanvassed (local UI convenience; not synced)
INSERT INTO RecentlyCanvassed (VanID,DateCreated) VALUES (2086019,'2026-07-05 08:58:03');
```

A *Lit Dropped* interaction (no survey) is just the `Canvasses` row with
`ResultID=21` (+ `CanvassAddresses` + `RecentlyCanvassed`).

---

## 7. Notes for programmatic writes
- Assign `CanvassID = MAX(CanvassID)+1` and keep it consistent across all
  `Canvass*` rows of the same interaction.
- Use a real per-list `CanvasserID`/`ListID` (read from `ExportSettings`) and the
  device's actual `DeviceUID` (read from any existing `Canvasses` row).
- `DateCreated` must be UTC `YYYY-MM-DD HH:MM:SS`. Space multiple canvasses a few
  seconds apart so they look natural.
- Validate `VanID ∈ People`, `ResultID ∈ ScriptResults`, and
  `(SurveyQuestionID, SurveyResponseID) ∈ ScriptSurveyQuestionResponses`.
- Force-stop the app before pushing an edited DB back; fix file ownership to the
  app's uid afterward.

---

## 8. Post-experiment findings (validated end-to-end)

Everything below was confirmed by injecting a single canvass for **Donald D Baker
(VanID 2249528)** — Canvassed + Imraan Support "2. Likely Support" + Yard Sign
"Yes" — on an Android emulator, then observing the app and syncing. **Server-side
receipt was verified by re-syncing the same list on a second, unmodified device**
and seeing Baker's response appear.

### 8.1 The injection round-trip works
- The app **reads injected rows as genuine canvasses**: Baker's detail showed
  status "Canvassed", the survey question rendered with **☑ 2. Likely Support**
  and **☑ Yes** — visually identical to a hand-entered canvass.
- On sync, MiniVAN packaged the responses DB, gzipped + HMAC-signed it with its
  embedded key, and uploaded it. **We never needed the signing key** — planting
  rows and letting the real app sync is sufficient.

### 8.2 Sync behavior (important)
- **Auto-sync is aggressive.** With `ExportSettings.IsAutoSyncEnabled=1`, the app
  **uploads pending rows automatically on launch** — no manual "Sync" tap needed.
  Injected rows left in the DB will go up the next time the app opens.
- **Rows are NOT cleared after a successful sync.** The `Canvasses`/`Canvass*`
  rows persist locally; the app tracks sync state elsewhere. Practically: don't
  rely on an empty table meaning "not yet synced," and re-syncing can re-present
  the same rows (VAN de-dupes server-side — see the `TeamCanvasses` unique index
  on `(VanID, ResultID, DateCreated, MiniVanExportID)` for the shape of its key).
- The header shows **"Last synced …"**; no error banner = upload succeeded.

### 8.3 DeviceUID — how to get it right
- Format: `Android-<release>-Device-<ro.product.model>-<id>`, e.g.
  `Android-14-Device-sdk_gphone64_arm64-6289c7dd469258a7`.
- The `<id>` suffix is **stable for the device/AVD** and **NOT** `Settings.Secure.
  ANDROID_ID` — after `pm clear` + re-login, ANDROID_ID changed but the DeviceUID
  suffix stayed the same.
- It is **not stored in plaintext prefs** (see 8.4); it is generated at runtime /
  held in the encrypted store. **To capture it on a fresh install:** record one
  throwaway canvass in the UI, pull the DB, read `Canvasses.DeviceUID`, then
  delete that throwaway row before injecting your real data. `inject_canvass.py`
  auto-detects it from any existing row, or takes `--device-uid`.

### 8.4 Where the app keeps state (`/data/data/<pkg>/shared_prefs/`)
| File | Holds |
|---|---|
| `CANVASSER_PREFERENCES.xml` | Auth session: `apiId`, `apiSecret` (auth0), `CANVASSER_ID`, and `CANVASSER` JSON (`CanvasserID`, name, `VanID`, `VanIDTenantUri`) |
| `com.voteractivationnetwork.minivan_preferences.xml` | Active list: `printedListNumber`, `printedListId`, `activeListId`, `activeListName`, `activeListPeopleCount`, `activeListDoorCount`, `ACTIVE_SYSTEM_URL` (`https://minivan.securevan.com`), `list_tenant_uri` |
| `minivan_storage.xml` | **Encrypted** (AndroidX Security / Tink `AesSiv`+`AesGcm` keyset) — not readable without the Keystore key |
| `active_list_details.xml` | Current UI filters (e.g. `ResultID` filter) |

The **printed list number `57429198-80406` maps to `listId 280640`** (a list can
be pulled by its printed number).

### 8.5 Synced object types (from the app's DAO layer)
On sync the app instantiates DAOs for exactly these response models, which map
1:1 to the `Canvass*` tables in §4: `CanvassResponse` (→ `Canvasses`),
`SurveyResponse`, `AddressResponse`, `ActivistCodeResponse`, `NoteResponse`,
`PhoneResponse`, `EmailResponse`, `ContributionResponse`, `CanvassEventResponse`,
`OrganizationContactResponse`, `OrganizationContactJobResponse`, `VideoResponse`,
`TeamCanvass`, and `RecentlyCanvassed`. If a capture type isn't in this list, the
app won't sync it.

### 8.6 Emulator operational notes (Android, arm64, Google APIs image)
- `adb root` works (Google APIs image, **not** "Google Play"). Required for DB access.
- **Location is broken** on this image: `adb emu geo fix` returns OK but never
  reaches the providers (`last location=null`), and the Extended-Controls GUI
  point didn't take either. MiniVAN's map/"Locating…" view therefore hangs.
- **Symptom when permission IS granted:** the app parks on an "Uh oh / We could
  not determine your location" screen that has **no buttons at all** — no retry,
  no dismiss. UI automation cannot escape it, so `download_list.py` silently
  spins until its 90s timeout and the job fails with "timed out waiting for list
  ... to become active".
- **Fix: deny the app's location permission.** The app then skips proximity
  sorting and is fully usable (list, canvass, sync all work). `download_list.py`
  revokes `ACCESS_FINE/COARSE_LOCATION` itself before driving the UI.
- With location denied the app shows a one-time "Enable Location Services"
  onboarding screen; dismiss it with **Skip** (`id/skip_button`), never "Get
  Started" (which re-prompts for the permission). `download_list.py` taps Skip.
- `set_location.sh` no longer grants MiniVAN location permission by default,
  because doing so is exactly what reproduces the dead-end screen above.
- Strict DB protocol: **force-stop the app before any pull/push**, and only
  launch it to let it read/sync. Editing while it runs risks the app overwriting
  your changes. The pull/push scripts force-stop automatically.

### 8.7 Toolkit (in this folder)
- `inject_canvass.py` — CSV (`VanID,ResultID,SurveyResponses,Note`) → app-faithful
  rows in a working copy of the responses DB (`--dry-run` supported).
- `pull_responses_db.sh <ListID> [out]` — force-stop + pull (Android emulator).
- `push_responses_db.sh <ListID> <db>` — force-stop + push + restore owner/SELinux.
- `set_location.sh` / `start_emulator.sh` — best-effort GPS pin (see 8.6 caveat).
- `pull_ios_docs.py <bundle_id> <dest>` — pull the DBs off a **physical iPhone**
  over USB via house_arrest (needs `pip install pymobiledevice3`; phone paired +
  unlocked). See §9.8.

---

## 9. Cross-device sync: what propagates and what doesn't (validated end-to-end)

Validated on list **`57166669-86760` → listId `277901`** ("List 57166669-86760")
by canvassing on one device and downloading/syncing the list on a second device
(an Android emulator, same VAN canvasser `132521958`). Network captures of both
sync directions are in `~/Downloads` (`sync-1..4`, `teamCanvasses`,
`teamCanvasses-2`).

### 9.1 The headline result
**Canvass results are NOT confined to the recording device.** Any device that
downloads the list and syncs receives the whole list's results — **but only the
dispositions.** The **survey/support answers, notes, and activist codes stay with
the recording device** (and VAN's central DB); they are never fanned out to other
devices.

| Data | Recording device (write-side + its upload) | Other devices (sync-down) |
|---|---|---|
| Disposition / `ResultID` (Canvassed, Not Home, Inaccessible, Refused, Moved, Lit Dropped) | ✅ | ✅ via `TeamCanvasses` |
| Survey/support answers (`CanvassSurveyResponses`, e.g. "Imraan Support = 2. Likely Support") | ✅ | ❌ |
| Notes (`CanvassNotes`) | ✅ | ❌ |
| Activist codes | ✅ | ❌ (only baked historical ones in the export) |

So a second canvasser sees "Battisti — **Canvassed**" but cannot see that he was
logged as a likely supporter.

### 9.2 The initial list export does NOT carry fresh field results
Right after download, the List DB's `PeopleContactHistory` / recent
`PeopleSurveyQuestionResponses` contain only **baked historical VAN data** (e.g.
2020–21 Party ID, 2011–18 activist codes) — **not** results other canvassers
recorded in the field. On list 277901 a freshly downloaded `PeopleContactHistory`
was empty even though the list had been actively canvassed. Field results arrive
via the **sync round-trip**, not the static export.

### 9.3 The sync round-trip (two directions, two payloads)

```
                                 ┌─────────────────────────── VAN ───────────────────────────┐
  UPLOAD (per-interaction delta)  │                                                            │  DOWNLOAD (whole-list dispositions)
  POST multipart MiniVANULNew.db.gz│                                                            │  GET teamCanvasses  (JSON)
  ── file: gzip(Responses-DB subset)                                                           │  [{vanId, canvassResultId,
     · Canvasses (+ CanvassPeople/Addresses)                                                   │    dateCanvassed, miniVanExportId}, …]
     · CanvassSurveyResponses  ◄── survey answers ride UP here                                 │       │ disposition only — NO survey field
  ── hash: base64 HMAC                                                                         │       ▼
        │ only rows pending since last sync (NOT the full DB, NOT TeamCanvasses)               │  Responses DB → TeamCanvasses (replace)
        ▼                                                                                      │
   MiniVANULNew.db on device keeps its own write-side rows ───────────────────────────────────┘
```

- **Upload** (`sync-1..4`, iOS `alamofire` multipart; Android writes the same
  package to `files/upload_db.gz`): contains **only the interaction(s) recorded
  since the last sync** — a delta. `sync-3`/`sync-4` were a single voter each
  (Kristin Aline, edited Not Home → Lit Dropped, same `CanvassID`); they carried
  **no trace** of other voters. A survey answer only appears in an upload whose
  delta includes that canvass (`sync-2` re-synced Battisti and re-emitted
  `CanvassSurveyResponses → 2947419 = "2. Likely Support"`).
- **Download** (`teamCanvasses` JSON): an array of
  `{vanId, canvassResultId, dateCanvassed, miniVanExportId}` for the **whole list**
  (all devices). No survey/notes fields exist in the schema. This lands verbatim in
  the Responses DB **`TeamCanvasses`** table (see §4.2) and is what the app renders
  as another device's "canvassed" history.

### 9.4 Where a survey answer actually lives (write-side vs sync-down)
Recording "Imraan Support = 3. Undecided" for Battisti (VanID `9465316`) on the
emulator wrote, in `canvass_277901_responses.db`:
- `Canvasses`: `CanvassID 2, VanID 9465316, ResultID 14 (Canvassed)`, DeviceUID of
  the recording device.
- `CanvassSurveyResponses`: `VanID 9465316, SurveyQuestionID 734728 → SurveyResponseID
  2947420 ("3. Undecided"), CanvassID 2` (joined to the `Canvasses` row).

Meanwhile Battisti's `TeamCanvasses` rows on that same device stayed
disposition-only (`ResultID 14`, no support level). **A `CanvassSurveyResponses`
row exists only on the device that recorded it**; on upload it goes to VAN, but
VAN's `teamCanvasses` fan-out to other devices drops it.

### 9.5 Implication
A shared MiniVAN list leaks **who was contacted and the outcome bucket** to every
canvasser who syncs it, but **not the content of the conversation** (support level,
notes). Treat `TeamCanvasses` as "coverage/coordination" data, and
`CanvassSurveyResponses`/`CanvassNotes` as device-local-until-uploaded and
**not** redistributed.

### 9.6 The recording device holds the COMPLETE response data (confirmed on iOS)
Pulled directly from the physical iPhone that did the canvassing (iOS MiniVAN
**9.4.3**, DeviceUID `15E71094-23C9-44B5-90B2-F4D7B31EC10B`). Its
`canvass_277901_responses.db` is the full write-side record — everything the
canvasser logged, not a delta:

| Table | Rows | |
|---|---|---|
| `Canvasses` | 126 | 83 Lit Dropped, 27 Canvassed, 13 Inaccessible, 2 Refused, 1 Moved |
| `CanvassSurveyResponses` | 27 | **25 × "3. Undecided", 2 × "2. Likely Support"** (Imraan Support) |
| `CanvassAddresses` | 126 | |
| `RecentlyCanvassed` | 123 | local UI only |
| `TeamCanvasses` | 131 | the sync-down set (dispositions; see §9.3) |

All 27 support answers live **only here** (and in VAN's central DB) — they are the
exact data that never reaches other devices. Battisti (VanID `9465316`) on the
iPhone: `Canvasses` row `CanvassID 129` = Canvassed, plus `CanvassSurveyResponses`
`734728 → 2947419 = "2. Likely Support"`, matching `sync-2` byte-for-byte.
(Contrast: the emulator's copy of Battisti shows "Undecided" — that was a separate
entry made on that device. VAN keeps both as history but hands other devices only
the "Canvassed" disposition.)

Note the two iOS files are different roles:
- **`MiniVANULNew.db`** — the **pending-upload buffer** (held ~1 canvass); this is
  what gets gzipped into the `sync-*` POST bodies. *Not* the full record.
- **`canvass_<ListID>_responses.db`** — the full write-side record above.

### 9.7 Downloading a different list WIPES the current list's on-device data
Menu → "Download a new list" (or entering a different list number) shows this
confirmation, which is the behaviour in one screen:

> *"As long as your results have been synced, no data will be lost. When
> downloading a new list your progress and stats will be reset. Redownloading a
> list will not give you access to your previous canvassing data."*

Validated on the emulator:
- Only the **active** list's DBs exist on-device; there is no multi-list retention.
- The instant you confirm the new download, `canvass_<oldid>.db` **and**
  `canvass_<oldid>_responses.db` are **deleted immediately** — before the new list
  even downloads (only the transient `upload_db.gz` remains).
- **Synced** data survives (on VAN; dispositions return via `TeamCanvasses`).
  **Unsynced** local canvasses are lost. Because downloading requires a network
  connection, online the app auto-syncs first — the real risk is switching lists
  with pending canvasses recorded **offline**.
- **Re-downloading the same list does NOT restore your local write-side data.**
  After re-downloading 277901: local `Canvasses` = 0 and `CanvassSurveyResponses`
  = 0 (the recorded "Undecided" was gone), while `TeamCanvasses` repopulated to 134
  dispositions. My "Undecided" canvass came back only as a *Canvassed* disposition
  (`2026-07-08T07:18:01Z`), never as the support answer — same asymmetry as §9.1.

### 9.8 Pulling MiniVAN's DBs off a physical iPhone (no jailbreak, no full backup)
MiniVAN exposes its `Documents` folder to the Files app ("On My iPhone > MiniVAN"),
so the DBs are reachable over USB via **house_arrest (documents channel)** — for a
**paired, unlocked** device. This is far better than a device backup.

- **On-device iOS location:** the app's container `Documents/` (vs Android's
  `/data/data/com.voteractivationnetwork.minivan/files/`). Same file names:
  `canvass_<ListID>.db`, `canvass_<ListID>_responses.db`, plus `MiniVANULNew.db`.
- **Tool:** `pull_ios_docs.py <bundle_id> <dest>` (needs `pip install
  pymobiledevice3`; requires the phone paired + unlocked). Pulls the whole
  `Documents` tree; output is byte-identical to a manual Files-app export.
  Ad-hoc equivalent: `pymobiledevice3 apps afc --documents <bundle_id>` → `ls` /
  `pull`.
- **Gotcha:** listing the vended AFC **root `/` is permission-denied** for this
  app; the files are under **`/Documents`** — target that. `pull_ios_docs.py`
  already does.
- **What does NOT work:** a *full-container* pull (`--no-documents`) →
  `InstallationLookupFailed`, because App-Store-signed apps don't vend their whole
  container (the `Library/` sqlite lives there but is unreachable this way); and a
  *full device backup* is the only alternative but is impractical (whole-device
  only, ~100 GB). The Files/house_arrest route sidesteps both.
