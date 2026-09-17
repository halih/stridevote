# Civibyte tools

This folder is the **ops side** of the Civibyte integration: HTTP pull helpers
and the payload reference. Next.js matching / list creation will live under
`src/lib/civibyte/` (same split as MiniVAN: `minivan_tools/` talks to the
emulator; `src/lib/minivan/` applies jobs).

Civibyte has no on-device SQLite. The schema doc describes the **guest REST
API** the public walk-list link uses.

## Prerequisites

1. A guest magic link (`https://civibyte.com/c/…`).
2. A 10-digit US phone the campaign will accept. If Civibyte has never seen the
   number, also set `CIVIBYTE_GUEST_NAME`.
3. Network access to `https://api.civibyte.com`.

Do **not** commit guest tokens, full session JSON, or voter dumps.

## Pull a session snapshot

```bash
CIVIBYTE_GUEST_PHONE=########## npx tsx --env-file=.env civibyte_tools/pull_session.ts https://civibyte.com/c/<token>
# full payload (PII — keep local):
CIVIBYTE_GUEST_PHONE=########## npx tsx --env-file=.env civibyte_tools/pull_session.ts https://civibyte.com/c/<token> --json
```

The summary prints session id, door/voter counts, and whether a script/survey
came back. Typed client: [`src/lib/civibyte/client.ts`](../src/lib/civibyte/client.ts).

## Docs

| File | What |
|---|---|
| [CIVIBYTE_DB_SCHEMA.md](CIVIBYTE_DB_SCHEMA.md) | Guest auth, session snapshot, door enums, canvass log body |

## Status

| Step | Where |
|---|---|
| Guest pull (read snapshot) | `pull_session.ts` + `src/lib/civibyte/client.ts` |
| Import into `List` / match voters | `src/lib/civibyte/import-list.ts` |
| Pull session dispositions into attempts | `src/lib/civibyte/pull-canvass.ts` |
| Push StrideVote knocks back to Civibyte | not started |
