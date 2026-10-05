# StrideVote

A mobile-first canvasser dashboard for progressive campaigns. Volunteers sign in
passwordlessly, discover nearby campaigns, check out walk lists, knock doors
(including offline), and sync results. Campaign admins cut turf, run canvass
waves, and review program results.

Native door-knocking is for **StrideVote** lists. MiniVAN / Civibyte lists can
still be tracked for checkout; knocking happens in those apps.

## Stack

- **Next.js 16** (App Router, TypeScript, `output: "standalone"`)
- **PostgreSQL** via **Prisma** — the only DB config is `DATABASE_URL`, so the same
  build runs on local Docker, AWS RDS/Aurora, Azure Database for PostgreSQL, or Neon.
- **Auth.js v5** (`next-auth`) — passwordless email magic links (day one) with a
  channel-agnostic OTP layer for phone SMS / WhatsApp (stubbed until a sender is set up).
- **react-leaflet** + OpenStreetMap tiles for district / turf maps.

## Quick start (local)

Prerequisites: Node 20.19+ (or 22) and Docker.

```bash
# 1. install deps
npm install

# 2. environment
cp .env.example .env        # the defaults work with the Docker db below

# 3. start Postgres
docker compose up -d db

# 4. create schema + demo data
npm run prisma:migrate      # applies the initial migration (creates tables)
npm run db:seed

# 5. run
npm run dev                 # http://localhost:3000
```

### Signing in during development

No email/SMS provider is required in dev. When you request a sign-in link, the
**magic link is printed to the server console and shown on the login screen**.

To land on a fully populated account, sign in with the seeded demo email:

```
demo@stridevote.local
```

Any other email address also works — it just creates a fresh, empty account so you
can see the campaign-discovery / join flow from scratch.

## Environment variables

Everything is configured through env vars (see [.env.example](.env.example)); no
cloud SDKs are baked into the app.

| Variable                  | Purpose                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `DATABASE_URL`            | Postgres connection string (local, RDS/Aurora, Azure, Neon).   |
| `AUTH_SECRET`             | Auth.js session/JWT secret. `npx auth secret` to generate.     |
| `AUTH_URL`                | Public base URL of the app.                                    |
| `AUTH_CHANNELS`           | Enabled login channels: `email`, `sms`, `whatsapp` (CSV).      |
| `RESEND_API_KEY`          | Optional — enables live email delivery via Resend.             |
| `SMTP_URL`                | Optional — enables live email delivery via SMTP.               |
| `EMAIL_FROM`              | From-address for magic-link emails.                            |
| `NEXT_PUBLIC_MAP_TILE_URL`| Optional — override the OpenStreetMap tile URL.                |
| `NEXT_PUBLIC_MAP_SATELLITE_TILE_URL` | Optional — override the satellite tiles behind the canvass map's satellite toggle (default Esri World Imagery). |
| `PLATFORM_ADMIN_EMAILS`   | CSV of emails granted platform super-admin (create/administer all campaigns). |
| `MAPBOX_ACCESS_TOKEN`     | Optional — temporary Mapbox overlay when a walk list is downloaded (not stored). |

## Campaign administration

Users with management access can switch to the desktop-first `/admin` console
from their profile menu. Access is permission-based and driven entirely by
campaign membership roles — no separate admin tables.

**Roles are cumulative.** A member can hold several roles per campaign (e.g. both
`admin` and `canvasser`), and each role grants a set of permissions. Roles and their
permissions are defined in one place — [src/lib/roles.ts](src/lib/roles.ts) — so
adding a role needs **no migration** (`CampaignMembership.roles` is a `String[]`).

| Role        | Grants                                                                 |
| ----------- | ---------------------------------------------------------------------- |
| `canvasser` | Check out this campaign's lists.                                       |
| `admin`     | Manage members, voters, lists/turfs, campaign settings, and deletion.  |

The desktop-first admin console at `/admin` lets an admin:

- **Members** — approve/decline join requests, add members by email/phone, and set
  each member's roles (a campaign admin may grant any role, including `admin`).
- **Lists** — create lists, edit their detail, link them to one or more campaigns,
  and delete them (blocked while checkouts are active).
- **Turfs** — view the campaign district, select a precinct or draw a turf
  polygon, and share each turf with all volunteers, assign it to one volunteer,
  or keep it private. Publishing a turf into a **wave** (canvass program) is
  what makes it available to knock.
- **Waves** — named canvass passes (e.g. Primary vs General) with a script,
  survey questions, and frozen walk snapshots. Volunteers check out a list
  *in a wave*; results stay scoped to that wave.
- **Voters** — search and filter authorized voter-file records by name,
  precinct, age, gender, election history, and canvass status.
- **Settings** — edit the campaign profile, tags, pickup, and primary contact.

Admins can switch between every campaign they administer from the campaign
context selector. Platform super-admins can additionally create campaigns.
Campaign admins can delete campaigns after a typed confirmation; deletion is
blocked while campaign-only lists have active checkouts.

Voter records are intentionally not bundled with the app. Washington campaigns
must import an authorized Secretary of State VRDB extract and comply with its
political-use-only restrictions.

```bash
npm run voters:import -- "/path/to/09.2026.WA.zip"
npm run voters:import-history -- "/path/to/WA SOS Elections Drop"
```

`voters:import` loads Active voters for the campaign's legislative district
(the demo campaign is LD 32). Use `--all` for a statewide load, `--status all`
to include Inactive records, or `--no-campaign` to skip campaign linking.

`voters:import-history` stores every matching SOS ballot row in `VoterHistory`
(2007–present). It accepts a folder of biennial `*Voting_History.zip` files,
a VRDB zip that contains a history file, or a loose `.txt`. By default it
keeps rows for voters already in the database; pass `--all` to keep
statewide history even when the voter is not imported yet.

History is classified from Washington election dates as general, primary,
presidential primary, or special. Likely-primary and likely-general flags mean
the voter participated in at least 50% of the applicable regular elections
held since they registered.

Only elections with a complete statewide ballot list count toward those rates.
A biennial history file lists every ballot for its elections, but the VRDB
`LastVoted` column gives only each voter's most recent ballot — so it is
complete for the newest election and partial for any older election the history
files have not caught up to. Partial elections are excluded from both the
numerator and the denominator. Imports rebuild these rates automatically; they
can also be refreshed independently with `npm run voters:rebuild-propensity`.

### Saved filters vs generated lists

**Saved filters** are campaign-shared named presets of the voter directory criteria
(search, precinct, age, audience checkboxes, etc.). On the Voters page, **Load** and
**Save** sit beside Apply / Clear: Load opens a dialog of saved presets, Save can
overwrite an existing one or create a new named filter. Loading re-applies the
criteria against **current** voter data — it does not freeze voter IDs. Pagination
is never stored. Any member with `voters:view` or `lists:manage` may manage them.

**Generated lists** are snapshots created from **Turfs** when cutting a
polygon (all campaign voters or a saved filter as the seed). If **any**
voter at an address matches the seed, that **household/door** is included and
**every campaign voter at that household** is written to `ListVoter` (including
non-matching roommates). `List.doorsCount` is the household count. Generated
lists default to private `draft`; existing turf visibility / assignment controls
remain the publishing step into a wave.

### Canvass waves, packets, and offline

A **CanvassProgram** (shown as a wave in admin) is one named pass over the
universe. Lists are published into a wave; household membership is copied into
`ProgramListHousehold` / `ProgramListVoter` so later turf edits do not rewrite an
in-progress walk.

Volunteers check out a StrideVote list, then download a **field packet**
(`/canvass/[listId]`). The packet includes walk order, script, questions, door
coords, and prior wave history. It is stored in IndexedDB on the phone.

- Results queue locally and POST to `/api/canvass/sync` when online.
- Packets expire **72 hours** after download (`PACKET_TTL_MS`). Reconnect to
  refresh before knocking further.
- Optional `MAPBOX_ACCESS_TOKEN` overlays temporary pins for ungeocoded doors
  for that session only — they are not written to the database or the offline
  cache.

### Precincts

Official precinct boundaries live in `Precinct`, imported from the WA Secretary
of State statewide shapefile (`npm run precincts:import`). `countyCode` + `code`
join directly to `Voter.countyCode` + `Voter.precinctCode`, so a precinct turf is
cut and counted **from registration data with no geocoding involved** — the voter
file's own precinct assignment is authoritative, and doors that Census could not
place are still counted.

The shapefile stores the code as a number while the voter file zero-pads it per
county (King 4 digits, Snohomish 8), so the import pads codes to the width each
county's voters already use. **Import voters before precincts.** The Turfs map
only offers precincts the campaign has voters in; drawn turfs still use geometry
and therefore still depend on coordinates.

```bash
npm run precincts:import                    # downloads the current WA dataset
npm run precincts:import -- --zip ./wa.zip  # or use a local archive
```

States with no imported dataset fall back to Census voting districts, which have
no usable precinct code and so are counted geometrically.

### Household geocoding

Addresses are normalized into `Household` rows (`npm run households:rebuild`).
Units stay distinct doors; street abbreviations and casing collapse. Each door
stores one persistent `lat` / `lng` plus `geocodeSource` (`census`, `county`,
or legacy `mapbox`). Geocoding is what places a door inside a **drawn** polygon;
precinct turfs do not need it.

Write rank (equal ranks do not replace each other): **county ≈ mapbox > census**.
Census street interpolations never overwrite county or Mapbox pins.

1. **Census (bulk baseline)** — free US Census batch API, no API key.
   `npm run households:geocode-census` is resumable (`geocodeStatus`, `--limit`,
   `--status`). Matched coords fill empty `lat`/`lng` with `geocodeSource=census`.
   Public Nominatim is **not** used for bulk voter geocoding.
2. **County GIS (fallback / upgrade)** — King and Snohomish address-point layers.
   `npm run households:geocode-county` fills null pins and upgrades Census pins
   (`--dry-run`, `--limit`, `--county KI|SN`). Uses FeatureServer geometry, not
   rounded Lat/Long attributes. Does not replace Mapbox-sourced pins.
3. **Mapbox (walk session only)** — optional `MAPBOX_ACCESS_TOKEN`. When a
   volunteer downloads a list, doors still missing `lat` get a **temporary**
   geocode for that session (map + walk order). Results are not written to the
   database or the 72-hour offline packet. Permanent Mapbox geocoding is not used.

```bash
npm run households:rebuild -- --campaign count-binface
npm run households:geocode-census -- --limit 5000
npm run households:geocode-county -- --dry-run
npm run households:geocode-county
```

**Platform super-admins** (via `PLATFORM_ADMIN_EMAILS` or `User.isPlatformAdmin`)
implicitly hold every permission on every campaign and are the only users who can
**create new campaigns**. Authorization helpers live in
[src/lib/authz.ts](src/lib/authz.ts); server actions in
[src/lib/admin-actions.ts](src/lib/admin-actions.ts) re-check permissions on every call.

The seeded `demo@stridevote.local` user is a platform admin, is an `admin` on two
campaigns, and has two pending join requests waiting to demo the approval flow.

## Cloud portability (AWS ↔ Azure)

The app is built to move between providers with **no code changes**:

- **Stateless container** — `output: "standalone"` + the multi-stage
  [Dockerfile](Dockerfile) produce one image that runs on AWS App Runner / ECS
  Fargate or Azure Container Apps / App Service.
- **State lives in Postgres only** — point `DATABASE_URL` at RDS/Aurora on AWS or
  Azure Database for PostgreSQL. Sessions are JWT, so there's no sticky session state.
- **Migrations on boot** — [docker-entrypoint.sh](docker-entrypoint.sh) runs
  `prisma migrate deploy` before starting the server.
- **No provider lock-in** — email/SMS/WhatsApp delivery is behind a small
  `OtpChannel` interface, and secrets come from env vars (map cleanly to AWS
  Secrets Manager or Azure Key Vault references).

```bash
docker compose up --build   # runs the production image locally against the db
```

## Data model

Canvass lists:

- `source` = `minivan` | `civibyte` | `stridevote`
- `sourceRef` = MiniVAN list-number **or** Civibyte URL
- `data` = JSON used for list-split bookkeeping (not generation metadata)
- `boundary` / `centroidLat` / `centroidLng` = geography for map + distance search

Waves and knocks: `CanvassProgram`, `ListCheckout` (per list+program),
`CanvassAttempt` (append-only, idempotent `clientAttemptId`).

See [prisma/schema.prisma](prisma/schema.prisma).

## Deferred integrations

These are stubbed with clear seams so they can be turned on later:

- **SMS OTP** — [src/lib/otp/adapters/sms.ts](src/lib/otp/adapters/sms.ts). Intended
  production path is AWS End User Messaging (we generate + store the code ourselves,
  avoiding per-verification fees). Requires a leased number + A2P 10DLC registration.
- **WhatsApp OTP** — [src/lib/otp/adapters/whatsapp.ts](src/lib/otp/adapters/whatsapp.ts)
  via the Meta WhatsApp Cloud API (requires Business verification).
- **MiniVAN** — gated per campaign (platform admin). Import / pull / push run
  through [`minivan_tools/`](minivan_tools/) and a local emulator worker; see
  that folder’s README.
- **Civibyte** — gated per campaign (platform admin). Guest-link pull lives in
  [`civibyte_tools/`](civibyte_tools/) (see that folder’s README and schema).
  Guest sessions can be imported as native lists and refreshed for new door
  results. Push sends newer StrideVote door results and matching survey answers
  through Civibyte’s idempotent guest batch API.

## Scripts

| Script                   | Description                          |
| ------------------------ | ------------------------------------ |
| `npm run dev`            | Dev server                           |
| `npm run build`          | Production build (standalone)        |
| `npm run start`          | Start the production server          |
| `npm run prisma:migrate` | Create/apply a dev migration         |
| `npm run prisma:deploy`  | Apply migrations (production)        |
| `npm run db:seed`              | Seed campaigns, lists, and demo user |
| `npm run db:reset`             | Reset the database and reseed        |
| `npm run voters:import`        | Load a WA SOS VRDB zip into `Voter`   |
| `npm run voters:import-history` | Load SOS voting-history files (2007+) |
| `npm run voters:rebuild-propensity` | Recalculate likely-voter rates |
| `npm run precincts:import`     | Load official precinct boundaries into `Precinct` |
| `npm run households:rebuild`   | Normalize addresses into `Household` rows |
| `npm run households:geocode-census` | Resumable Census batch geocoding |
| `npm test`                     | Unit tests (filters, addresses, geo) |

## Continuous integration

`.github/workflows/test.yml` runs `npm test` on every push to `main` and on
every pull request. A failing test marks the commit red and GitHub emails the
Actions failure.

Two dependency quirks to know before touching `package.json`:

- **Regenerate `package-lock.json` on Linux.** npm records the transitive deps
  of optional platform packages (`@img/sharp-wasm32` → `@emnapi/*`) only for the
  platform it ran on, so a lock written on macOS makes CI's `npm ci` fail with
  "Missing: @emnapi/… from lock file". Refresh it with the same Node major CI
  uses: `docker run --rm -v "$PWD":/app -w /app node:24 npm install --package-lock-only`.
- **`overrides.nodemailer`** pins nodemailer past the `^7.0.7 || ^8.0.5` peer
  range that `next-auth`/`@auth/core` still declare. Safe here because our email
  provider in `src/lib/auth.ts` delivers through `sendVerificationRequest` and
  next-auth never loads nodemailer itself.
