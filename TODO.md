# Follow-ups

Remaining work from the post-canvass review. Check an item when you want it next.

## Field-test blockers

- [ ] Stop sample stats when a user has no attempts — show zeros, not fake 794 doors
- [ ] Fix drawn-turf generation to use the bbox household query (same as preview), and one coordinate preference (Mapbox if present, else Census) in SQL and JS
- [ ] Don’t silently mix Census VTDs with official precincts in the turf picker (label or disable)
- [ ] Cap / warn Mapbox session geocode on packet download (timeouts, cost, doors with no pin)
- [ ] Restore prior person answers when updating a door (and show seed vs roommate)

## Data / sync integrity

- [ ] Snapshot is frozen after publish — no live-list backfill mid-wave; optional “republish” action
- [ ] Compute “current attempt” in SQL (or a `current` flag) instead of loading all attempts
- [ ] Conflict policy if two devices / late stale checkout disagree (last-write vs reject)
- [ ] Scope ListWatch to program, or drop watches if unused in the field
- [ ] IndexedDB PII — encrypt, shorter TTL, or wipe on logout / list complete

## Product / UX for real walking

- [x] Start walk order from volunteer GPS when available (packet is still server-ordered today)
- [ ] Ungeocoded doors stay on precinct lists but are obvious on the walk (list-only, not missing)
- [ ] Hide MiniVAN/Civibyte “create list” unless you are actually importing
- [x] Derive campaign volunteer count from memberships (drop the typed `volunteers` field)
- [ ] Partial precinct-batch failures — per-turf results, not “first error only”
- [ ] Turf overlap warning for drawn polygons

## Cleanup (leftover)

- [ ] Wire or delete `getAttemptLeaderboard`; include `moved` in stats outcome counts
- [x] Deduplicate RDP/downsample helpers in `geocode.ts` vs `precinct-geometry.ts`

## Later / not blocking a WA precinct field test

- [ ] PostGIS or a real polygon clip (today: ray-cast + drop vertices outside the district)
- [ ] Real MiniVAN/Civibyte import
- [ ] `MAX_PRECINCTS` (400) warning when a district is truncated
- [ ] Tile provider other than public OSM for production volume
