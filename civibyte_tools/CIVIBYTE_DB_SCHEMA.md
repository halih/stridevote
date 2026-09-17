# Civibyte Guest API Schema Reference

Reference for the HTTP payloads Civibyte’s guest canvassing app uses. Written
for humans and AI agents working with Civibyte data (importing a walk list into
StrideVote, and later writing canvass results back).

Civibyte is **not** an on-device SQLite store like MiniVAN. The analog of
MiniVAN’s List DB is a JSON session snapshot from the guest API. The analog of
the Responses DB is a set of authenticated write endpoints (`log-canvass`,
claim/release/skip/complete).

- **Source:** Civibyte web app (`civibyte.com`) talking to `https://api.civibyte.com`
- **Observed session:** `d3120987-4a7f-4694-9d6f-27d27f898f38` — “SHL 32-0038 + 1 other”
  (Cindy Ryu; 174 doors, 273 voters; all doors `AVAILABLE` at pull time)
- **Guest link shape:** `https://civibyte.com/c/<token>` (alias:
  `/canvassing-session/<token>`)
- **Auth:** volunteer phone + magic-link token → Bearer `guestToken`
- **Not covered yet:** logged-in campaign APIs (`/api/turfs`, `/api/canvassing-sessions`
  without guest), matchback, or an official OpenAPI dump (Swagger is gated)

---

## 1. Sync model (how read and write relate)

```
                 open /c/<token> + phone
   Civibyte  ──────────────────────────►  GET .../guest/canvassing/sessions/{id}
                                          (walk list + script + survey + prior visits)
                                                 │
                                           volunteer works
                                                 │
                                                 ▼
                                          POST .../log-canvass[/batch]
                                          POST .../doors/{doorId}/claim|release|skip|complete
                                                 │
                                          session snapshot on next GET
   Civibyte  ◄──────────────────────────────────────────────────────────
```

- The **session GET** is a snapshot of doors, voters, script, and survey. It is
  the pull surface for StrideVote import.
- Every knock the guest app records is a **canvass log** keyed by
  `clientSubmissionId` (client-assigned UUID). Batch POST is the offline-sync path.
- Door **claim/release** is live coordination between guests on the same session.
  A StrideVote import should treat claim state as ephemeral and not persist it as
  a canvass result.
- **Pull vs push:** pull is the session GET (doors + voters + prior-visit fields).
  StrideVote push uses the idempotent batch endpoint and records acknowledged
  attempt IDs in `List.data.civibyte.pushedAttempts`.

---

## 2. Shared conventions

| Thing | Shape | Notes |
|---|---|---|
| IDs | UUID string | `canvassingSessionId`, `sessionDoor.id`, `guestVolunteerId` are UUID v4. `voterPk` / `addressPk` look like UUID v5 (deterministic). |
| Phone | 10-digit US string | Digits only. Client strips formatting and a leading `1`. |
| Coordinates | `latitude` / `longitude` number | WGS84. Present on every observed session door and building. |
| Timestamps | ISO-8601 string | Guest log uses `createdAt: new Date().toISOString()`. Door `attemptedAt` / `claimedAt` are nullable strings. |
| Auth header | `Authorization: Bearer <guestToken>` | Required on guest canvassing routes. Unauthenticated calls return HTTP 403. |
| Campaign header | `X-Campaign-Id` | Used by the logged-in app, **not** by the guest magic-link flow. |

**Join keys**

| Key | Joins |
|---|---|
| `sessionDoor.id` (`sessionDoorId` on writes) | Door row in the session |
| `addressPk` | Building door ↔ session door; also on canvass logs |
| `voterPk` | `sessionDoors[].voterPks[]` → `votersById[voterPk]` |
| `stateVoterId` | Civibyte voter → StrideVote `Voter.stateVoterId` (WA SOS id as a decimal string) |

---

## 3. Auth (magic link)

Base: `https://api.civibyte.com`

### 3.1 `POST /api/magic-links/check-phone`

Body: `{ "phoneNumber": "4253454399" }`

| Field | Type | Meaning |
|---|---|---|
| `exists` | boolean | Phone already has a guest volunteer row |
| `name` | string \| null | Display name when `exists` is true |
| `guestVolunteerId` | string? | Observed when `exists` is true |

If `exists` is false, the UI collects a name before validate.

### 3.2 `POST /api/magic-links/validate`

Body: `{ "token": "<link token>", "name": "<volunteer name>", "phoneNumber": "##########" }`

| Field | Type | Meaning |
|---|---|---|
| `isValid` | boolean | Token accepted |
| `guestToken` | string | Bearer token for guest APIs |
| `canvassingSessionId` | string | Session UUID (use this, not the URL token, for GET) |
| `guestVolunteerId` | string | Volunteer UUID |
| `script` | object \| omitted | Same `{ id, name, body }` as on the session snapshot |

Invalid / expired tokens: `isValid` false, or HTTP error. The guest UI copies
`guestToken` into local storage as a guest-role session.

---

## 4. SESSION SNAPSHOT — `GET /api/guest/canvassing/sessions/{id}`

Read side. 174 doors / 273 voters on the observed list.

Top-level object:

| Field | Type | Purpose |
|---|---|---|
| `canvassingSessionId` | string | Session UUID |
| `sessionName` | string | Walk-list title (precinct-ish label on the sample) |
| `candidateDisplayName` | string \| null | Candidate shown in the guest welcome |
| `status` | string | Observed: `ACTIVE` |
| `plannedStartAt` | string \| null | Unused on the sample (`null`) |
| `sessionLocation` | unknown \| null | Unused on the sample (`null`) |
| `sessionDoors` | SessionDoor[] | **The walk list.** One row per knockable unit |
| `buildings` | Building[] | Map clustering; one building per house on the sample |
| `votersById` | `{ [voterPk]: Voter }` | People at those doors |
| `script` | Script \| null | Door-knock script text |
| `survey` | Survey \| null | Questions attached to a contact |

### 4.1 `sessionDoors[]` (SessionDoor)

| Column | Type | Meaning | Sample |
|---|---|---|---|
| `id` | string | Session-door UUID; write-side `sessionDoorId` | `1c450439-…` |
| `addressPk` | string | Stable address key | `b6016ff1-…` |
| `buildingAddress` | string | Street without unit | `1115 N 183RD ST, SHORELINE, WA 98133` |
| `completeAddress` | string | Street + unit | `1115 N 183RD ST, # 204, SHORELINE, WA 98133` |
| `latitude` / `longitude` | number | Pin | `47.76096`, `-122.344643` |
| `voterPks` | string[] | Residents at this unit | 1–3 on the sample (83 / 83 / 8 doors) |
| `status` | string | Live door state — see §6 | `AVAILABLE` |
| `claimedBy` / `claimedByName` / `claimedAt` | string \| null | Current claim | null when available |
| `canvassedById` / `canvassedByName` | string \| null | Who logged this session’s result | |
| `doorResult` | string \| null | This session’s disposition — see §6 | |
| `attemptedAt` | string \| null | When `doorResult` was logged | |
| `priorVisitResult` | string \| null | Earlier pass disposition | all null on first pull |
| `priorVisitAttemptedAt` / `priorVisitCanvassedByName` | string \| null | Earlier pass metadata | |

StrideVote import should key doors on `addressPk` (or normalized
`completeAddress`) and people on `stateVoterId` via `votersById`.

### 4.2 `buildings[]`

Map layer. On the sample, 174 buildings, each with exactly one door;
`buildingPk` was always `null`; `apartment` and `isApartment` were both `false`.

| Column | Type | Meaning |
|---|---|---|
| `buildingAddress` | string | Shared building line |
| `latitude` / `longitude` | number | Building pin |
| `apartment` / `isApartment` | boolean | Duplicate flags in the payload |
| `buildingPk` | string \| null | Present for true multi-unit buildings (unobserved) |
| `doors[]` | BuildingDoor[] | Units in the building |

**BuildingDoor:** `addressPk`, `doorLabel` (same as `completeAddress`),
`doorType` (observed: `HOUSEHOLD`), `voterPks`, `knocked` (boolean).

### 4.3 `votersById` (Voter)

| Column | Type | Meaning |
|---|---|---|
| `voterPk` | string | Map key; 36-char UUID |
| `stateVoterId` | string \| null | WA SOS voter id (6–8 digit strings on the sample) |
| `firstName` / `middleName` / `lastName` | string \| null | Names as stored (often ALL CAPS) |
| `age` | number \| null | Integer age |
| `gender` | string \| null | Observed: `F`, `M`, `U` |
| `tags` | Tag[] \| null | Optional labels |

**Tag:** `{ tagId: number, name: string }` — example observed:
`{ "tagId": 27, "name": "WA 2026 Primary — Already Voted" }`.

The guest UI also carries `firstName` / `lastName` / `age` / `gender` / `tags`
into in-memory “person” cards. Phones and emails are **not** on this snapshot.

### 4.4 `script`

```json
{ "id": "<uuid>", "name": "Cindy + Keith", "body": "Hello, are you _______?\\n…" }
```

`body` is volunteer-facing markdown-ish text (not a structured question list).

### 4.5 `survey`

```json
{
  "id": 14,
  "name": "Default Survey",
  "questions": [
    {
      "surveyQuestionId": 19,
      "questionId": 13,
      "text": "Will you be voting for Cindy this November?",
      "internalLabel": "Support 5-point",
      "responseType": "single_select",
      "required": true,
      "displayOrder": 1,
      "options": [
        { "id": 70, "label": "Oppose Cindy", "displayOrder": 1 },
        { "id": 71, "label": "Lean Against", "displayOrder": 2 },
        { "id": 72, "label": "Unknown", "displayOrder": 3 },
        { "id": 73, "label": "Lean Cindy", "displayOrder": 4 },
        { "id": 74, "label": "Strong Cindy", "displayOrder": 5 }
      ]
    }
  ]
}
```

`survey.id` / `questionId` / `surveyQuestionId` / option `id` are integers.
`responseType` observed: `single_select`. Other types exist in the client
(answers may use `answerOptionIds`, `textValue`, or `numericValue`) but were
not on this session.

---

## 5. WRITE SIDE — guest canvassing mutations

All under `https://api.civibyte.com/api/guest/canvassing`. Bearer required.

### 5.1 Door lifecycle

| Method | Path | Guest app use |
|---|---|---|
| POST | `/sessions/{id}/doors/{doorId}/claim` | Take an `AVAILABLE` door |
| POST | `/sessions/{id}/doors/{doorId}/release` | Put it back (`AVAILABLE`) |
| POST | `/sessions/{id}/doors/{doorId}/skip` | Mark `SKIPPED` |
| POST | `/sessions/{id}/doors/{doorId}/complete` | Mark `COMPLETED` without a log? (paired with log in the UI) |
| POST | `/sessions/{id}/doors/{doorId}/reopen` | Edit after complete (original canvasser only in UI) |
| POST | `/sessions/{id}/doors/{doorId}/evict` | Take a door claimed by someone else |
| GET | `/sessions/{id}/doors/{doorId}/canvass` | Reload answers for a completed door |
| GET | `/sessions/{id}/volunteers` | Live volunteer pins |

Claim/release/skip/complete/reopen/evict request bodies were empty in the
client (`POST` with no JSON). Response shapes were not captured on this pass.

### 5.2 `POST /log-canvass` and `POST /log-canvass/batch`

Batch body is a **JSON array** of canvass logs. Fields the client actually sends:

| Field | Type | Meaning |
|---|---|---|
| `clientSubmissionId` | string | Client UUID; idempotency key |
| `canvassingSessionId` | string | Session UUID (batch only; single-log local row also stores it) |
| `sessionDoorId` | string | `sessionDoors[].id` |
| `addressPk` | string | Same as the door |
| `doorResult` | string | Disposition enum — §6 |
| `doorNotes` | string \| undefined | Optional notes |
| `someoneElseContacted` | boolean | Contact was not a listed resident |
| `voters` | CanvassVoter[] | People talked to + answers |

**CanvassVoter**

```json
{
  "voterPk": "<uuid>",
  "answers": [
    {
      "questionId": 13,
      "answerOptionIds": [74],
      "textValue": null,
      "numericValue": null
    }
  ]
}
```

Non-contact dispositions POST `voters` as `{ voterPk, answers: [] }` for
everyone at the door. The UI locally sets `status: "COMPLETED"` and
`pendingSync: true` until batch ACK returns matching `clientSubmissionId`s.

Local IndexedDB also stores `createdAt`, `attempts`, and `state`
(`pending` \| `syncing`) — those are **not** in the batch POST.

### 5.3 Volunteers (live)

`GET /sessions/{id}/volunteers` is polled for other guests. The map overlay
expects `{ volunteerId, name, latitude, longitude, timestamp }`. Exact response
envelope not captured.

---

## 6. Enums (from the guest client)

**Session `status` (top-level):** `ACTIVE` observed.

**Door `status`:**

| Value | Meaning |
|---|---|
| `AVAILABLE` | Unclaimed |
| `CLAIMED` | Held by `claimedBy` |
| `COMPLETED` | Result logged this session |
| `SKIPPED` | Skipped this session |

**Door `doorResult` / `priorVisitResult`:**

| Value | Guest label | StrideVote door outcome |
|---|---|---|
| `CONTACT` | Contact made | `contact` |
| `NO_ANSWER` | No answer | `no_answer` |
| `REFUSED` | Refused | `refused` |
| `LIT_DROPPED` | Lit dropped | `lit` |
| `UNSAFE` | Unsafe | `unsafe` |
| `INACCESSIBLE` | Inaccessible | `inaccessible` |
| `OTHER` | Other | *no mapping yet* |

Civibyte has no `MOVED` / `DECEASED` on this guest enum. MiniVAN’s deceased skip
does not apply here.

**Building `doorType`:** `HOUSEHOLD` observed.

**Survey `responseType`:** `single_select` observed.

---

## 7. Mapping notes for StrideVote

| Civibyte | StrideVote |
|---|---|
| Guest URL `https://civibyte.com/c/<token>` | `List.source = "civibyte"`, `List.sourceRef` = that URL |
| `canvassingSessionId` | Store on `List.data.civibyte` (session id can change if the link is reissued; the URL token is the volunteer-facing handle) |
| `sessionDoors[]` | `ListHousehold` + walk order; pin from lat/lng (`geocodeSource` TBD, e.g. `civibyte`) |
| `votersById[].stateVoterId` | Match `Voter.stateVoterId` (same idea as MiniVAN VanID match, but SOS id is stronger) |
| `completeAddress` / unit in `# 204` | `normalizeHouseholdAddress` |
| `script.body` | Optional seed for `CanvassProgram.script` |
| `survey.questions` | Optional seed for `CanvassProgram.questions` (5-point support on the sample) |
| `priorVisitResult` | Import as a prior attempt only after we confirm timestamps and canvasser identity |
| Claim/release | Do **not** import; live-only |

Match-or-skip: prefer `stateVoterId`. Fall back to MiniVAN-style
last + house number + ZIP only if SOS id is missing.

---

## 8. Other APIs the SPA knows about (not guest pull)

The logged-in app’s `baseUrl` is the same host. Endpoint map (for later; not
exercised here):

`/api/login`, `/api/campaigns`, `/api/turfs`, `/api/turf-members`,
`/api/canvassing-sessions`, `/api/canvassing-scripts`, `/api/voter-data/voters`,
`/api/voter-groups`, `/api/voter-tags`, `/api/surveys`, `/api/questions`,
`/api/jobs`, `/api/magic-links`, plus admin `/api/admin/*`.

Do not call these with a guest token.

---

## 9. Open questions

1. Exact JSON for `GET .../doors/{id}/canvass` (needed to pull survey answers,
   not just door dispositions).
2. Whether `priorVisitResult` is filled on a second-day GET of the same session
   or only on a new session built from the same turf.
3. `OTHER` door result and any unobserved `responseType` values.
4. Whether `buildingPk` is populated for apartments and how units nest.
5. Rate limits (`x-rate-limit-remaining: 299` observed) and token TTL.
6. A campaign-authenticated write API would provide cleaner attribution than
   the current guest-token push.

---

## 10. Pulling a snapshot locally

See [README.md](README.md). Summaries only by default — do not commit full
`--json` dumps (they contain voter names and SOS ids).
