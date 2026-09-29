# Bugs

Code-review findings for the whole codebase. Remove an item when it is fixed (or deliberately accepted). Known field-test work already listed in `TODO.md` is not repeated here unless this review found a sharper failure mode.

Jargon used below:

- **Wave** — a named canvass pass on a campaign (`CanvassProgram`). Lists are published into a wave; knocks are stored against that wave.
- **Packet** — the walk list downloaded onto the phone. Lives in IndexedDB for offline use.
- **Outbox** — unsynced knocks waiting on the phone.
- **Field layer** — durable household/voter state (access, moved, progressive scores) written back from knocks, across campaigns.
- **Stale checkout** — a knock accepted after the volunteer no longer holds the list.

---

## Auth / security

- [ ] **`.env.example` ships a production-accepted Auth.js secret**

  The example says to leave `AUTH_SECRET` blank but sets it to the public value `this-is-a-real-secret`. Production validation rejects a different old placeholder, so a deployment copied from the example boots with a known signing secret. Keep the example blank and make the guard reject every documented placeholder.

- [ ] **Dev inbox is public in any non-production build**

  `/api/dev` is excluded from the cookie guard. The inbox returns recent magic links and OTP codes with no auth, and omitting `to` dumps every recent message. `NODE_ENV !== "production"` counts as “dev,” including tunneled `next dev`. Bind to localhost, require a secret, never list all recipients, and compile it out of real deploys.

- [ ] **OTP send has no throttle; extra codes reset the guess budget**

  Anyone can POST `/api/otp` forever (SMS cost / harassment). Verification always uses the newest challenge, so requesting another code resets the five-attempt limit. Rate-limit by destination and IP, cooldown, and keep one attempt budget across codes.

- [ ] **OTP consume and attempt counting are not atomic**

  Two correct submits can both see `consumedAt = null`. Concurrent wrong guesses can all see `attempts < 5`. Atomically increment / consume (`UPDATE … WHERE consumedAt IS NULL`), and only succeed if one row changed.

- [ ] **SMS / WhatsApp adapters always log the plaintext code; email can log magic links**

  Stub SMS/WhatsApp `send()` prints the code. In non-production, email falls back to the plaintext-logging dev stub not only when no provider is configured, but whenever `deliverEmail` throws for *any* reason — a Resend API error, an SMTP failure, a bad recipient, a provider outage (`src/lib/otp/adapters/email.ts` catches and retries with `forceDevStub: true` whenever `env.isDev`). A shared staging/tunnel deployment that has a real provider configured still leaks a live magic link into the public dev inbox (see the item above) the moment delivery to a given address fails once. Never log credentials outside an explicitly local stub, and prevent tunnel/shared development deployments from exposing them.

- [ ] **OTP codes hash with a guessable default salt outside production**

  `hashCode()` (`src/lib/otp/index.ts`) falls back to the hardcoded literal `"dev"` as salt whenever `AUTH_SECRET` is unset, and `AUTH_SECRET` is only required when `NODE_ENV === "production"`. Any non-prod deployment that forgets to set it stores every `OtpChallenge.codeHash` salted with a public constant. Low-impact today since codes are already logged in plaintext (above), but it would silently undermine the DB-side hash if that logging bug is fixed without also requiring a real secret outside production.

- [ ] **One campaign’s admin can rename, archive, unlink, or push a shared list**

  `canManageList` is true if the user manages *any* linked campaign. Rename/archive affects every campaign; relinking deletes every `ListCampaign` row while checking only campaigns being kept, and is not transactional; external push selects whichever enabled campaign link appears first. Require permission on every affected campaign, make these operations atomic, or make lists campaign-owned.

- [ ] **Voter detail can show other campaigns’ field events**

  Access is checked for the requested campaign, but field events are loaded by voter/household only, including other campaigns’ names and canvasser identity. Filter to campaigns the caller may view, or show only shared, anonymized derived state.

- [ ] **Client `capturedAt` is trusted with no clock bounds**

  Any ISO datetime is stored and used to pick the “current” knock and to stamp scores. A year-9999 knock stays current forever. Bound client time, keep a server receipt time, and do not let the client pick durable “now.”

- [ ] **IndexedDB packets and outbox are not scoped to the signed-in user**

  Keys are `programId:listId` only. On a shared browser, user B can see user A’s cached voters if they can open the same list — and can sync A’s outbox as B’s work. Namespace by user id and wipe or quarantine on account change. (Product retention for packets is still in `TODO.md`.)

- [ ] **Removed volunteers can retain or regain packet access**

  Packet download checks an active checkout plus list visibility/assignment, but not current campaign membership or `canvass:checkout`. The walk route can recreate a checkout from a stale assignment, and removing membership does not release existing checkouts or assignments. A removed volunteer can revisit a saved walk URL and download voter PII and history. The same "auto-claim checkout from an `assigned` list link" logic is independently duplicated in `getCanvassBoard` (`src/lib/data.ts`), re-checking only cached `activeMemberships` rather than `canvass:checkout` at claim time — a fix needs to cover both call sites or they will drift apart again.

- [ ] **Email magic-link send has no throttle**

  Email sign-in immediately sends through Auth.js/Resend/SMTP with no destination or IP cooldown. Repeated submissions can harass a recipient and consume provider quota, just like the separately tracked OTP send abuse.

- [ ] **MiniVAN import can match against the entire voter table**

  If the campaign has no `CampaignVoter` rows yet, `applyMinivanImport` loads up to 500,000 statewide voters, matches MiniVAN people against them, and writes phones/emails/`likelyParty` onto those master records. Scope matching to the campaign (or fail until voters are synced).

---

## Data / sync integrity

- [ ] **Off-list checkbox at a single-voter door creates a duplicate phantom person**

  A single-voter household auto-selects that voter (`DoorSheet.tsx`), and the "Who" checkbox list that would let you deselect them only renders when a door has more than one voter — but "Not on the list" is still offered. Checking it while the auto-selected voter stays checked makes `buildPeople` emit **both** the listed voter and a synthetic off-list person from the same group, with identical support/talk-score/survey answers. One conversation with someone who isn't Jane gets recorded as two contacted people and overwrites Jane's field-layer talk score/support with data that was never about her. Clear the listed voter automatically when "Not on the list" is checked at a single-voter door, or block the combination.

- [ ] **"Current" knock selection has no tiebreaker for equal `capturedAt`**

  `capturedAt` is client-supplied with no bound (see above), and every "current result" query orders by `capturedAt desc` alone (`progress.ts`, three call sites) with no secondary key. A double-tap save, two volunteers finishing the same door at the same client-reported instant, or a skewed device clock produces two attempts with identical `capturedAt`; which one "wins" as current depends on undefined database row order and can flip between page loads. Add a stable secondary sort (`id` or server receive order).

- [ ] **Split can delete the local packet before confirming its replacement downloaded**

  `CanvassView.tsx`'s split-confirm flow calls `deletePacket` then `downloadPacket` in one `try`, swallowing failure with only a comment that refresh is "best-effort." If the device goes offline right after a split completes (plausible — the split itself required connectivity), the volunteer's offline copy is gone with no replacement until they're back online and reopen the list. Don't delete the old packet until the new one has downloaded successfully.

- [ ] **Older offline knocks overwrite newer field-layer scores**

  Household observed score and voter talk score / moved are written unconditionally. A 10:00 knock synced after an 11:00 knock wins. Standalone observed-score retries are also unsafe: duplicate `clientEventId` suppresses a second event, but still rewrites denormalized household state from the old payload. Update only when `capturedAt` is newer (atomic SQL), or recompute from `FieldEvent`.

- [ ] **Field writeback is not retried after a successful knock**

  Native sync, MiniVAN pull, and Civibyte pull commit the attempt before field events and denormalized columns. A failure leaves knock history committed; retries see the existing attempt and skip without finishing writeback. Put both in one transaction, or keep a writeback-pending flag and retry it.

- [ ] **Outbox is keyed only by list, not by wave**

  IndexedDB’s `by-list` index ignores `programId`. Opening Primary can merge/sync General’s queued knocks for the same list id. Index by `(programId, listId)`.

- [ ] **Packet download still backfills live turf into the wave snapshot**

  Same freeze issue as `TODO.md`: if the live list is longer than the snapshot, download copies the extra doors. Sync also falls back to live `ListHousehold` / `ListVoter` when the snapshot has no row. Treat publish as freeze; require an explicit republish.

- [ ] **Splitting one wave corrupts completion thresholds in older waves**

  Split rewrites global live membership and `List.doorsCount`, but rewrites only the selected wave’s snapshot. An older wave can retain its full snapshot while release compares progress to the new half-sized global count, marking that older walk complete too early.

- [ ] **Double-tap save creates two “current” knocks**

  Save and quick-result buttons have no lock. Two UUIDs can both supersede the same prior id, so neither is superseded. Disable submit until enqueue finishes; add a stable tie-break (`createdAt` / id) when `capturedAt` matches.

- [ ] **Incomplete offline packets are still walkable**

  A short packet sets an error *and* still renders doors. Saves are blocked for expired packets, not incomplete ones. Volunteers can finish and release a subset. Hide result controls until a full download.

- [ ] **List-board release proceeds when IndexedDB cannot be checked**

  The list board catches an outbox read failure and releases anyway, unlike the walk screen. If IndexedDB is broken or unavailable while knocks remain queued, the volunteer can release the list and abandon unsynced work.

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

- [ ] **Voter-history and voter imports normalize state IDs differently**

  History import strips a `WA` prefix and leading zeros, while VRDB import stores `StateVoterID` verbatim. Valid history rows can be skipped or stored without a voter link when the source formats differ.

- [ ] **Campaign region edits report success without saving the region**

  The update schema and form submit centroid, region, and boundary fields, but `updateCampaignProfile` writes none of them. Voter sync, precinct loading, and turf boundaries continue using the old district after a successful save message.

- [ ] **MiniVAN pull and push can switch to the wrong wave**

  Both flows call `ensureActiveProgram` instead of using the list’s published `ListCampaign.programId`. After the active wave changes, pull can create attempts in a wave where the list was never published and push can export results from the wrong wave.

- [ ] **MiniVAN’s first-initial fallback match can bind enrichment to the wrong voter**

  `matchMinivanPeople` (`src/lib/minivan/match.ts`) falls back from a full first-name match to a first-initial match whenever exactly one candidate at the same (lastName, streetNo, zip) shares the initial, and treats that as confirmed (`matched_initial`). Import then writes MiniVAN phone/email/`likelyParty` (and can seed talk score) onto that record. "J. Smith" from MiniVAN can bind to "Jane Smith" when the real contact was "John Smith," permanently corrupting a different voter's master data with no reconciliation path.

- [ ] **Civibyte pull and push can act on an arbitrary campaign link when a list is shared**

  `pullCivibyteList` and `pushCivibyteList` (`src/lib/admin-actions.ts`) both pick `campaignLinks.find(active && enabled) ?? campaignLinks.find(enabled)` — independent of which campaign the admin is actually working in. If a Civibyte list is linked to two or more campaigns and none has the currently active wave, the choice is whatever order Prisma returns. An admin can get a spurious "Not allowed" on their own campaign's list, or push results into / pull results tagged to a campaign other than the one they intended. Same defect class as the MiniVAN wrong-wave item above, but a distinct mechanism (campaign, not program) and code path.

- [ ] **MiniVAN job complete/fail endpoints don’t validate the job’s current status**

  `completeMinivanJob` and `failMinivanJob` (`src/lib/minivan/jobs.ts`) do an unconditional `update` by id with no precondition on the job's current `status`/`type`, unlike the apply-import/apply-pull handlers which do check `status !== "running"`. A retried worker POST, a duplicate call, or anyone holding the single shared worker token can mark a never-claimed `pending` job "completed" with fabricated results, or flip an already-finished job back and forth — corrupting job history and making the admin UI report success for work that never ran.

- [ ] **Civibyte "candidate support" question is identified by a fragile heuristic**

  `push-map.ts` treats a Civibyte survey question as the candidate-support question whenever its text/internal label contains the substring "support" and it has exactly 5 options. Any unrelated question matching both (e.g. "Financial support level") silently receives the volunteer's 1–5 support rating instead of its own answer, corrupting that field with no error.

- [ ] **MiniVAN lit drops create several current knocks for one door**

  Pull expands one household lit result to every VanID, then creates one unsuperseded `CanvassAttempt` per voter at the same household and timestamp. Current-result selection, reports, and push can choose an arbitrary row.

- [ ] **MiniVAN jobs have no lease or crash recovery**

  Claiming marks a job `running`, and the queue refuses all other work while any running row exists. There is no heartbeat, timeout, or reclaim path; a worker crash or uncaught apply error strands that job and blocks the entire queue indefinitely.

- [ ] **External imports are not atomic**

  MiniVAN enriches voters and creates/relocates households before list creation. Civibyte commits the list before snapshotting it into the wave. A failure can leave partial master-data changes or a live unsnapshotted list while reporting failure, and duplicate-source checks can then block a clean retry.

- [ ] **Civibyte import can relocate a voter globally**

  Import upserts `HouseholdVoter` with the household parsed from Civibyte and overwrites an existing household link. Stale or malformed vendor data changes that voter’s master household for every campaign and future list.

- [ ] **External source references are editable identity keys**

  List edit allows arbitrary `sourceRef` changes, while MiniVAN idempotency and Civibyte authentication/idempotency trust that field. Editing a printed-list number or guest URL can duplicate pulls, target a different remote list, or pair old metadata with another session.

- [ ] **Civibyte guest tokens are persisted and sent to field devices**

  Civibyte pull builds `clientAttemptId` from the full guest-link URL. That ID is stored on attempts and returned as the current attempt ID in field packets, exposing the bearer-style token through IndexedDB, logs, and exports. Use a hash or opaque canonical source ID.

- [ ] **Civibyte pull can duplicate knocks after a session rebuild**

  Door matching deliberately falls back from mutable session-door ID to stable `addressPk`, but the attempt ID still includes the mutable door ID. If Civibyte rebuilds/reissues door rows, the same remote knock can be imported again under a new key.

- [ ] **Civibyte push silently drops off-list contacts’ survey answers**

  `push-canvass.ts`'s door mapping explicitly skips any person with `voterId == null` — i.e. every off-list respondent — when building the exported `voters` array, and required-answer validation only checks that array. The only surviving trace of an off-list conversation is a `someoneElseContacted` boolean; their actual support rating and survey answers are discarded with no counter and no error.

- [ ] **A transient Civibyte detail failure permanently drops person answers**

  Door-detail requests use `Promise.allSettled`; a failed detail request still creates the door attempt without contacted people or survey answers. Future pulls see the attempt ID and skip it, so the missing detail is never repaired.

- [ ] **MiniVAN key migration can duplicate prior pulls**

  Current code changes pull IDs from StrideVote list ID to printed-list number without looking up or healing IDs written by the old scheme. The first pull after deployment can recreate every previously imported result. Migrate legacy IDs or recognize both formats.

---

## Admin / reporting / product bugs

- [ ] **Turf access edits silently target the wrong wave**

  `TurfAccessCard.save()` (`CampaignTurfManager.tsx`) calls `setTurfAccess(campaignId, turf.id, visibility, assignedUserId)`, omitting the optional `programId` argument. `setTurfAccess` then falls back to the campaign's *currently active* wave instead of the turf's actual wave. Editing sharing/assignment on any list that belongs to a non-active wave (e.g. a draft "Wave B" while "Wave A" is active) looks up the wrong `ListCampaign` row and fails with "Turf not found in this wave," even though it plainly is. `createTurf`/`createPrecinctTurfs` pass `programId` correctly — only this call site is missing it.

- [ ] **Reports free-text answers silently truncated to 25 distinct values**

  `admin-reports.ts` sorts `textResponses` by count and slices to the top 25 with no total-count indicator, and the dashboard renders only that array with no "showing N of M" note — the same silent-truncation pattern as the already-documented 200-knock, 90-day, 400-door, and 15-list caps in this file, just not yet applied here.

- [ ] **Canvass board conflates checkouts from different waves**

  The board emits one card per list and can select an active checkout by another user without constraining it to the card’s program. A list checked out in one wave can therefore appear taken in another even though checkout exclusivity is scoped by `(listId, programId)`.

- [ ] **The same list can be split twice concurrently**

  Split ownership is checked before the transaction, and there is no uniqueness constraint preventing two splits of the same source list/program. A double submit or two requests can create competing released lists and redirects from the same starting membership.

- [ ] **Program results silently use only the last 200 knocks**

  Outcome totals, unique doors, volunteer totals, and “superseded” are derived from `take: 200`. After 200 knocks the dashboard is wrong (and a replacement can look current if the newer row is off the page). Aggregate in SQL; paginate history separately.

- [ ] **“Whole wave” charts still cap at 90 days**

  Headlines use every current door in the wave; pace / daily outcome charts start at `max(createdAt, now − 89 days)` when range is “wave.” Enumerate from wave start, or label the cap.

- [ ] **List edit only loads the first 400 doors**

  Admin list detail `take`s 400 doors from the database, then paginates that slice in the client. The map and walk-order numbering miss the rest. Page on the server or load all ids for the map.

- [ ] **Required survey questions are not required**

  The model supports `required: true`, but the program editor has no required control, the door sheet’s `canSave` ignores it, and sync does not validate answers against the wave definition. Expose and enforce it on client and server.

- [ ] **Civibyte survey answers disappear from reports**

  Pull stores answers under Civibyte’s numeric question IDs, while reports read answers by StrideVote program-question IDs. Unless those unrelated IDs happen to match, imported answers are silently omitted.

- [ ] **Civibyte’s walk sheet gives obsolete sync guidance**

  The sheet says results logged in Civibyte do not sync back, but pull support is now available to volunteers and admins. This can cause volunteers to duplicate work or organizers to skip a supported pull.

- [ ] **Reports coverage chart silently drops lists after 15**

  The coverage chart uses `view.coverage.slice(0, 15)` without saying it is truncated. The detail list below contains every list, so organizers can mistakenly treat the chart as complete.

- [ ] **Volunteer “Response rate” is actually contact rate**

  Stats calculate contacts divided by every door outcome, including no-answer, lit, and inaccessible. Calling that “Response rate” is ambiguous and inconsistent with reports, which label the same concept “contact rate.”

- [ ] **“Send message” to a campaign contact does nothing**

  The button toasts “Message sent” and discards the text. Wire it up or remove/rename until messaging exists.

- [ ] **Voter directory “Include any of” is OR, including Canvassed**

  Likely primary / likely general / new voter / canvassed are one `OR`. Checking Canvassed *and* Likely primary shows anyone who matches either, not both. If organizers expect AND, split canvassed out of that group.

- [ ] **`programId` on voter filters is unused**

  The query string and saved filters store `programId`, but canvass audience is always campaign-wide. Drop the field or actually scope canvassed/exclude to that wave.

- [ ] **Failed availability email consumes the one-shot watch**

  Release deletes watches before awaiting delivery. A transient provider failure leaves the volunteer unsubscribed without receiving the notification.

- [ ] **Lint currently fails with five React-hook errors**

  `npm run lint` reports `setState` in effects (`BottomSheet`, twice in `WalkView`, and `CampaignTurfManager`) plus an immutability error in `ReportsDashboard`, along with two warnings. These block adding lint to CI.

---

## Deploy / tooling

- [ ] **Containers boot after `prisma migrate deploy` fails**

  `docker-entrypoint.sh` prints the error and still starts the server. Fail the container (or run migrations as a separate job).

- [ ] **`npm run dev` SIGKILLs whatever is on port 3000**

  `predev` always runs `free-port.mjs`, which `kill -9`s any listener. Refuse to start, or only kill a PID this project created.

- [ ] **`npm run db:reset` has no safety guard**

  `"db:reset": "prisma migrate reset --force"` skips Prisma's interactive confirmation and drops/recreates the database unconditionally. The seed script does refuse to re-seed when `NODE_ENV === "production"`, but that check only runs *after* the drop. A stray `DATABASE_URL` pointed at a shared/staging database (bad `.env`, wrong shell export) gets wiped with zero confirmation and zero check on the destructive step itself.

- [ ] **Containers can boot against an unmigrated schema with no warning**

  `docker-entrypoint.sh` only runs `prisma migrate deploy` `if [ -n "$DATABASE_URL" ]`; when that variable is unset or misnamed (a typo, or a platform that names the secret differently), the block is skipped with no log line at all before `exec node server.js`. Distinct from the already-listed "boots after migrate fails" bug — this is a silently *skipped* migration, not a failed one.

- [ ] **A personal ngrok hostname is hardcoded in Next.js config**

  `allowedDevOrigins` includes `duckie-hammad.ngrok.app` alongside the generic ngrok patterns. It leaks a private tunnel name into shared config and gives that one hostname special development-origin access.

- [ ] **README documents the wrong standalone production command**

  Next is configured with `output: "standalone"` and the repository provides `npm run start:prod` to launch that output, but the scripts table tells operators to use `npm run start` (`next start`). Document the standalone launcher and the county-geocode script, and keep the documented Node version aligned with CI/Docker.

- [ ] **CI runs unit tests only**

  GitHub Actions runs Prisma generation and 114 unit tests, but not lint, a production build, migration deployment, or database-backed integration tests. Transaction, constraint, generated-client, and framework build failures can still merge. It also has no explicit `permissions:` block, so `GITHUB_TOKEN` gets the org/repo default (often broader than `contents: read`) for a workflow that runs `npm ci` against third-party packages.

---

## Already tracked in TODO.md (not duplicated)

Drawn-turf generation scalability, Census-vs-official precinct picker, Mapbox volume on packet download, freeze-after-publish (listed above only where sync still accepts live membership), in-memory “current knock,” collision policy, packet PII/TTL policy, ungeocoded precinct doors, batch precinct error reporting, overlapping drawn turfs, real polygon clip, precinct map cap of 400, production map tiles, external-source identity design, MiniVAN survey round-trip, database-backed lifecycle tests, saved-location removal, OTP retention, county-geocode retry state, split-redirect chain cap, stuck outbox entries, MiniVAN pull writeback-on-skip, walk-map camera scope, wave question removal, campaign-region edit UI, Civibyte HTTP timeout/retry, Civibyte import centroid, and the VRDB birth-year ceiling.
