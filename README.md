# StrideVote

A mobile-first canvasser dashboard for progressive campaigns. Volunteers sign in
passwordlessly, discover nearby campaigns, check out canvass lists (turf) sourced
from MiniVAN / Civibyte, and track their impact.

> This phase covers **login, list checkout tracking, campaign discovery, and
> stats**. The door-knocking flow itself is intentionally out of scope.

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
npm install --legacy-peer-deps

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
| `PLATFORM_ADMIN_EMAILS`   | CSV of emails granted platform super-admin (create/administer all campaigns). |

## Campaign administration

Users with management access see a **Manage** tab. Access is permission-based and
driven entirely by campaign membership roles — no separate admin tables.

**Roles are cumulative.** A member can hold several roles per campaign (e.g. both
`admin` and `canvasser`), and each role grants a set of permissions. Roles and their
permissions are defined in one place — [src/lib/roles.ts](src/lib/roles.ts) — so
adding a role needs **no migration** (`CampaignMembership.roles` is a `String[]`).

| Role        | Grants                                                                 |
| ----------- | ---------------------------------------------------------------------- |
| `canvasser` | Check out this campaign's lists.                                       |
| `admin`     | Approve/add members, assign roles, manage lists, edit campaign profile.|

The Manage console ([/manage](src/app/(app)/manage)) lets an admin:

- **Members** — approve/decline join requests, add members by email/phone, and set
  each member's roles (a campaign admin may grant any role, including `admin`).
- **Lists** — create lists, edit their detail, link them to one or more campaigns,
  and delete them (blocked while checkouts are active).
- **Settings** — edit the campaign profile, tags, pickup, and primary contact.

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

Canvass lists store platform-specific detail flexibly:

- `source` = `minivan` | `civibyte` | `manual`
- `sourceRef` = MiniVAN list-number **or** Civibyte URL
- `data` = free-form JSON for any per-platform payload
- `boundary` / `centroidLat` / `centroidLng` = geography for map + distance search

See [prisma/schema.prisma](prisma/schema.prisma).

## Deferred integrations

These are stubbed with clear seams so they can be turned on later:

- **SMS OTP** — [src/lib/otp/adapters/sms.ts](src/lib/otp/adapters/sms.ts). Intended
  production path is AWS End User Messaging (we generate + store the code ourselves,
  avoiding per-verification fees). Requires a leased number + A2P 10DLC registration.
- **WhatsApp OTP** — [src/lib/otp/adapters/whatsapp.ts](src/lib/otp/adapters/whatsapp.ts)
  via the Meta WhatsApp Cloud API (requires Business verification).
- **Door-outcome stats** — [src/lib/stats-source.ts](src/lib/stats-source.ts) returns
  sample data today. Replace `getDoorStats` with a real query once stats are imported
  from the canvassing platform; the Stats UI consumes the same shape unchanged.

## Scripts

| Script                   | Description                          |
| ------------------------ | ------------------------------------ |
| `npm run dev`            | Dev server                           |
| `npm run build`          | Production build (standalone)        |
| `npm run start`          | Start the production server          |
| `npm run prisma:migrate` | Create/apply a dev migration         |
| `npm run prisma:deploy`  | Apply migrations (production)        |
| `npm run db:seed`        | Seed campaigns, lists, and demo user |
| `npm run db:reset`       | Reset the database and reseed        |
