# Bugs

Code-review findings for the whole codebase. Check an item when it is fixed (or decided not to fix). Known field-test work already listed in `TODO.md` is not repeated here unless this review found a sharper failure mode.

Verified fixed and removed (Sep 2026): outbox chunking past 100 knocks, per-knock note clipping so one long note cannot 400 the batch, exclusive checkout via a partial unique index + `claimActiveCheckout`, creating/updating an active wave no longer closes siblings first, assigned lists can “Complete & release” when every door is done. Updating a door no longer wipes conversation people/notes (packet hydrates prior answers; lit/inaccessible keep person data; observed scores persist without replacing the knock). Formatted phone OTP login uses the API’s E.164 destination (and Auth.js normalizes again) so verification and the dev inbox match. Canvass sync requires a checkout this user held and refuses archived/deleted lists; person responses must live at the knock’s household. `.env.example` no longer ships a known `AUTH_SECRET` or a platform-admin email; production rejects the example secret. Unused unauthenticated `ensureCampaignProgram` export removed. Profile phone save stays unique-only until OTP bind (see `TODO.md`).

Jargon used below:

- **Wave** — a named canvass pass on a campaign (`CanvassProgram`). Lists are published into a wave; knocks are stored against that wave.
- **Packet** — the walk list downloaded onto the phone. Lives in IndexedDB for offline use.
- **Outbox** — unsynced knocks waiting on the phone.
- **Field layer** — durable household/voter state (access, moved, progressive scores) written back from knocks, across campaigns.
- **Stale checkout** — a knock accepted after the volunteer no longer holds the list.

---

## Field-test / walk blockers

- [x] **Updating a door wipes the conversation (worse than TODO.md)**

  `TODO.md` already tracks restoring prior answers. The packet’s `current` object still has no people or notes. The sheet starts notes empty and rebuilds conversation groups from scratch. “Lit drop” / “Inaccessible” on a done door replace the knock with `people: []` and `notes: null`. Hydrate the sheet from the last result, and do not let quick actions drop person data. Persist observed sign scores without replacing the knock.

- [x] **Formatted phone numbers cannot finish OTP login**

  `/api/otp` normalizes `(206) 555-0134` to E.164 before hashing. The login form then verifies with the original typed string, so the hash never matches. The form also ignores the `destination` returned by the API. Dev inbox lookup uses the same unnormalized string, so the on-screen test code never appears either. Keep the normalized destination from the API (or normalize again in Auth.js).

---

## Auth / security

- [x] **Canvass sync does not check who may write**

  `/api/canvass/sync` only requires a signed-in user. It confirms the list is published in that wave, then accepts the knock. No campaign membership, `canvass:checkout`, visibility, assignment, or `deletedAt` / `archivedAt` check. Missing checkout only sets `staleCheckout: true`. Anyone with cached IDs (or a removed volunteer) can write results and field-layer scores, including onto an archived list. Require current permission, or a prior checkout the same user actually held, and refuse archived lists/campaigns.

- [x] **Person responses are not tied to the door being logged**

  Sync accepts a voter if they appear *anywhere on the list*, not at `householdId`. A knock on door A can mark a voter at door B moved/scored. Check `HouseholdVoter` for that household as well as list membership.

- [ ] **Dev inbox is public in any non-production build**

  `/api/dev` is excluded from the cookie guard. The inbox returns recent magic links and OTP codes with no auth, and omitting `to` dumps every recent message. `NODE_ENV !== "production"` counts as “dev,” including tunneled `next dev`. Bind to localhost, require a secret, never list all recipients, and compile it out of real deploys.

- [ ] **OTP send has no throttle; extra codes reset the guess budget**

  Anyone can POST `/api/otp` forever (SMS cost / harassment). Verification always uses the newest challenge, so requesting another code resets the five-attempt limit. Rate-limit by destination and IP, cooldown, and keep one attempt budget across codes.

- [ ] **OTP consume and attempt counting are not atomic**

  Two correct submits can both see `consumedAt = null`. Concurrent wrong guesses can all see `attempts < 5`. Atomically increment / consume (`UPDATE … WHERE consumedAt IS NULL`), and only succeed if one row changed.

- [x] **An unverified profile phone becomes a login key** *(deferred — unique save for now)*

  Saving a phone still writes it onto the user so we can store numbers without paid OTP. Email and phone stay unique per user. OTP bind is tracked in `TODO.md`; do that before enabling phone login.

- [ ] **SMS / WhatsApp adapters always log the plaintext code; email can log magic links**

  Stub SMS/WhatsApp `send()` prints the code. Email with no live provider (or after a *dev* delivery failure) logs the full magic link — and `isDev` is any non-production `NODE_ENV`. Fail startup in production unless every enabled channel has a real provider; never log credentials outside an explicit local stub.

- [x] **`.env.example` ships a known `AUTH_SECRET` and a real platform-admin email**

  Copying the example into a reachable deploy grants that inbox platform admin and uses a public JWT secret. Leave admin emails blank; reject the example secret outside local dev.

- [x] **`ensureCampaignProgram` is an unauthenticated server action**

  It is still exported from `"use server"` with no session check and can activate or create a “Default” wave for any campaign id. It is unused in the UI. Remove the export or require `lists:manage`.

- [ ] **One campaign’s admin can archive or unlink a shared list**

  `canManageList` is true if the user manages *any* linked campaign. Archive (`deletedAt`) then hides the list for every campaign. Relinking still deletes every `ListCampaign` row and only checks permission on the campaigns being kept. Require permission on every affected campaign, or make lists campaign-owned.

- [ ] **Voter detail can show other campaigns’ field events**

  Access is checked for the requested campaign, but field events are loaded by voter/household only, including other campaigns’ names and canvasser identity. Filter to campaigns the caller may view, or show only shared, anonymized derived state.

- [ ] **Client `capturedAt` is trusted with no clock bounds**

  Any ISO datetime is stored and used to pick the “current” knock and to stamp scores. A year-9999 knock stays current forever. Bound client time, keep a server receipt time, and do not let the client pick durable “now.”

- [ ] **IndexedDB packets and outbox are not scoped to the signed-in user**

  Keys are `programId:listId` only. On a shared browser, user B can see user A’s cached voters if they can open the same list — and can sync A’s outbox as B’s work. Namespace by user id and wipe or quarantine on account change. (Product retention for packets is still in `TODO.md`.)

- [ ] **MiniVAN import can match against the entire voter table**

  If the campaign has no `CampaignVoter` rows yet, `applyMinivanImport` loads up to 500,000 statewide voters, matches MiniVAN people against them, and writes phones/emails/`likelyParty` onto those master records. Scope matching to the campaign (or fail until voters are synced).

---

## Data / sync integrity

- [ ] **Older offline knocks overwrite newer field-layer scores**

  Household observed score and voter talk score / moved are written unconditionally. A 10:00 knock synced after an 11:00 knock wins. Update only when `capturedAt` is newer (atomic SQL), or recompute from `FieldEvent`.

- [ ] **Field writeback is not retried after a successful knock**

  The attempt is committed first; field events and denormalized columns run afterward; errors are swallowed. A retry sees the existing `clientAttemptId` and returns ok without finishing writeback. Put both in one transaction, or keep a writeback-pending flag and retry it.

- [ ] **Outbox is keyed only by list, not by wave**

  IndexedDB’s `by-list` index ignores `programId`. Opening Primary can merge/sync General’s queued knocks for the same list id. Index by `(programId, listId)`.

- [ ] **Packet download still backfills live turf into the wave snapshot**

  Same freeze issue as `TODO.md`: if the live list is longer than the snapshot, download copies the extra doors. Sync also falls back to live `ListHousehold` / `ListVoter` when the snapshot has no row. Treat publish as freeze; require an explicit republish.

- [ ] **Double-tap save creates two “current” knocks**

  Save and quick-result buttons have no lock. Two UUIDs can both supersede the same prior id, so neither is superseded. Disable submit until enqueue finishes; add a stable tie-break (`createdAt` / id) when `capturedAt` matches.

- [ ] **Incomplete offline packets are still walkable**

  A short packet sets an error *and* still renders doors. Saves are blocked for expired packets, not incomplete ones. Volunteers can finish and release a subset. Hide result controls until a full download.

- [ ] **Online refresh failure throws away a good cache**

  If the device is “online,” Walk always re-downloads. A failed API call errors out even when IndexedDB has a valid packet. Fall back to the cache with a stale warning.

- [ ] **Walk deletes the packet before release succeeds**

  On the walk screen, `purgePacketIfSynced` still runs *before* `releaseList`. If release fails, the list is still theirs and the offline copy is gone. (The list-board release path already purges only after `ok`.) Release first; purge only on success.

- [ ] **Re-requesting join demotes active members to pending**

  `requestJoinCampaign` always writes `status: "pending"`, including for people already active. An admin can lock themselves out. No-op success if already active.

- [ ] **Campaign contacts cannot be cleared**

  Clearing name/role and saving reports success, but the action only writes when both are non-empty. Treat empty as delete.

- [ ] **Profile can save old coordinates under a new method**

  Switching Address → ZIP without pressing Find still saves the previous lat/lng with `source: "zip"`. Clear or stale-flag `resolved` when method or inputs change.

- [ ] **“Moved” cannot be undone from a later knock**

  Field writeback only sets `residenceStatus` to `moved`. A replacement contact never restores `ok`. Add a correction event and recompute current residence.

- [ ] **Permanent campaign delete still wipes knocks**

  Archive keeps lists and field events, but `deleteCampaign` still `DELETE`s the campaign. `CanvassAttempt.campaignId` is `ON DELETE CASCADE`, so every knock goes with it even though `FieldEvent.campaignId` is `SET NULL`. Either block hard delete while attempts exist, or match the field-event keep-alive.

- [ ] **VRDB import never unlinks voters who left the district**

  Monthly import upserts and inserts `CampaignVoter` rows. Inactive or moved-out voters stay on the campaign forever. Reconcile links against the latest import scope.

- [ ] **Unzip failures can look like a successful import**

  `unzip -p` streams are not waited on for exit code. A CRC-failed archive can commit a partial file, then rebuild propensity. Reject unless the child exits 0.

- [ ] **Precinct import deletes first, then reads the shapefile**

  Existing precincts are wiped before the replacement is validated. A bad file leaves the county empty. Stage, validate, then swap in a transaction.

- [ ] **Propensity rebuild can skip the latest regular election**

  Completeness uses the newest date across *all* election types. If the latest row is a special, VRDB-only primaries/generals may not count as complete. Compute “latest complete” per election type.

---

## Admin / reporting / product bugs

- [ ] **Program results silently use only the last 200 knocks**

  Outcome totals, unique doors, volunteer totals, and “superseded” are derived from `take: 200`. After 200 knocks the dashboard is wrong (and a replacement can look current if the newer row is off the page). Aggregate in SQL; paginate history separately.

- [ ] **“Whole wave” charts still cap at 90 days**

  Headlines use every current door in the wave; pace / daily outcome charts start at `max(createdAt, now − 89 days)` when range is “wave.” Enumerate from wave start, or label the cap.

- [ ] **List edit only loads the first 400 doors**

  Admin list detail `take`s 400 doors from the database, then paginates that slice in the client. The map and walk-order numbering miss the rest. Page on the server or load all ids for the map.

- [ ] **Required survey questions are not required**

  Questions may set `required: true`, but the door sheet’s `canSave` ignores them and sync does not validate answers against the wave definition. Enforce on client and server.

- [ ] **“Send message” to a campaign contact does nothing**

  The button toasts “Message sent” and discards the text. Wire it up or remove/rename until messaging exists.

- [ ] **Voter directory “Include any of” is OR, including Canvassed**

  Likely primary / likely general / new voter / canvassed are one `OR`. Checking Canvassed *and* Likely primary shows anyone who matches either, not both. If organizers expect AND, split canvassed out of that group.

- [ ] **`programId` on voter filters is unused**

  The query string and saved filters store `programId`, but canvass audience is always campaign-wide. Drop the field or actually scope canvassed/exclude to that wave.

- [ ] **Lint currently fails on walk / sheets / reports**

  `npm run lint` errors: `setState` in effects (`WalkView`, `BottomSheet`, `CampaignTurfManager`) and an immutability flag in `ReportsDashboard`. Not user-facing by themselves, but they block CI if lint is gated.

---

## Deploy / tooling

- [ ] **Containers boot after `prisma migrate deploy` fails**

  `docker-entrypoint.sh` prints the error and still starts the server. Fail the container (or run migrations as a separate job).

- [ ] **`npm run dev` SIGKILLs whatever is on port 3000**

  `predev` always runs `free-port.mjs`, which `kill -9`s any listener. Refuse to start, or only kill a PID this project created.

- [ ] **PWA / email icons 404**

  The web manifest still points at 512 and 1024 PNGs; email HTML points at a 120px PNG. Those files are not under `public/brand` (SVGs exist). Add the PNGs or drop the PNG entries.

- [ ] **No CI; `npm run build` does not run tests or lint**

  The defects above (auth, sync, checkout races) have no automated coverage. Existing tests are unit tests of pure helpers.

---

## Already tracked in TODO.md (not duplicated)

Coordinate mismatch on drawn turfs, Census-vs-official precinct picker, Mapbox volume on packet download, freeze-after-publish (listed above only where sync still accepts live membership), in-memory “current knock,” collision policy, watches not scoped to a wave, packet PII/TTL policy, ungeocoded precinct doors, MiniVAN/Civibyte pointer lists, batch precinct error reporting, overlapping drawn turfs, real polygon clip, precinct map cap of 400, production map tiles.
