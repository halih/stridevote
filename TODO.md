# Follow-ups

Remaining work from the post-canvass review. Check an item when you want it next.

Jargon used below:

- **Wave** — a named canvass pass on a campaign (e.g. Primary vs General). Lists are published into a wave; knocks are stored against that wave.
- **Packet** — the walk list downloaded onto the phone (doors, script, survey, map points). Lives in IndexedDB for offline use.
- **Drawn turf** — a polygon an admin draws on the map. Membership is “whose geocoded address falls inside.”
- **Precinct turf** — cut by official precinct code from the voter file. Does not need coordinates to count doors.

---

## Field-test blockers

- [ ] **Generate drawn turfs from the nearby box, not the whole campaign**

  Preview and generation now use the same persistent household pin, so their polygon membership agrees. Generation still loads every matching seed voter and expands every matching household in the campaign before clipping the result in memory. Start with the polygon’s bounding box in the database, as preview does, so a real district does not time out.

- [ ] **Don’t mix Census voting districts with official precincts**

  If WA precincts are not imported (or the campaign-voter join finds none), the turf map falls back to Census “voting districts.” Those look like precincts but their codes do not match the voter file, so you cannot cut a real precinct turf from them. Either hide that fallback in the same picker, or label it clearly as “geometry only / not voter-file precincts.”

- [ ] **Cap / warn Mapbox on packet download**

  When a volunteer opens a list, we may call Mapbox for every door that still has no stored pin. That is billed, can make download slow or fail, and doors that still have no pin just vanish from the map. Put a limit or a confirmation on those calls, and surface doors that stay unpinned instead of failing silently.

- [ ] **Mark list targets vs other voters at the door**

  `matchedSeed` reaches the packet, but the walk UI does not show which people matched the list’s source filter and which were included only because they share the household.

---

## Data / sync integrity

- [ ] **Freeze the walk snapshot after publish**

  Publishing a list into a wave is supposed to freeze who is on it. Packet download still copies extra doors from the live turf if the snapshot is shorter, so an admin who edits the turf mid-walk can change what a volunteer sees. Removed doors also stay on the old snapshot. Treat publish as freeze; if you need updates, add an explicit “republish this wave” action.

- [ ] **Compute “current knock” and stats aggregates in the database**

  “What is the latest result at this door?” and volunteer stats/leaderboards are calculated by loading attempts and folding them in application memory. Fine for demo data; slow and fragile once a wave has tens of thousands of knocks. Store/query current rows directly and aggregate reporting metrics in SQL.

- [ ] **Decide what happens when two results collide**

  If a volunteer syncs after the list was released, or two phones log the same door, we currently accept the extra knock and mark it `staleCheckout` for admin. That may be right, or we may want to reject / last-write-wins. Pick a rule and make the volunteer UI say what happened, not only an admin footnote.

- [ ] **Voter data on the phone (IndexedDB)**

  Packets hold names, ages, addresses, and survey answers on the device for 72 hours. Decide whether that is acceptable for field use, then encrypt, shorten the TTL, and/or wipe on logout and when the list is completed.

---

## Product / UX for real walking

- [ ] **Ungeocoded doors on precinct walks should be obvious**

  Precinct turfs correctly include doors Census could not place (the voter file precinct is enough). On the walk those doors have no map pin, so they are easy to skip. Keep them on the list and mark them as “no map location” so people still knock them.

- [ ] **Batch precinct create: report each turf, not only the first error**

  Creating many precincts now continues after failures and keeps the successful turfs, but the result names only the first error. If 18 of 20 succeed, report which two failed and why.

- [ ] **Warn when drawn polygons overlap**

  Two drawn turfs can contain the same door. Precinct-by-code lists do not overlap; freehand polygons can. Warn (or block) when a new polygon covers doors already on another list in the same wave.

---

## Later / not blocking a WA precinct field test

- [ ] **Real polygon clip (or PostGIS)**

  When a precinct straddles the campaign district, we currently drop vertices that fall outside. That is not a true clip: the shape can go wrong or the precinct can become unselectable. Fine for a first WA test; replace before statewide use.

- [ ] **Warn when a district has more than 400 precincts**

  The map loads at most 400 precincts and silently drops the rest. A large district can be missing precincts with no message.

- [ ] **Production map tiles**

  Default tiles are public OpenStreetMap. That is not a volume-production plan; set `NEXT_PUBLIC_MAP_TILE_URL` (or another provider) before lots of volunteers hit the map.

- [ ] **Bind profile phone only after OTP once SMS is live**

  Profile currently saves a unique phone onto the user so organizers can store numbers without paying for OTP. Email and phone are unique per user. When phone login is enabled, require a successful OTP before `User.phone` becomes a sign-in key, so a typo or someone else’s number cannot take over the account.

- [ ] **Use canonical records for external list identity**

  MiniVAN printed-list numbers and Civibyte guest links currently double as editable list metadata, remote identity, and idempotency keys. Store a stable vendor source record separately from mutable URLs/credentials, and let intentional split peers reference it.

- [ ] **Complete MiniVAN survey round-trip**

  MiniVAN pull imports door dispositions only, and push maps candidate support but not the wave’s other survey answers. Add adapter-backed mappings in both directions.

- [ ] **Add database-backed lifecycle tests**

  Unit tests cover pure mapping and planning helpers, but not the Prisma transactions and constraints that protect sync/writeback, list relinking, split concurrency and redirects, multi-wave checkout isolation, external pull idempotency, or campaign deletion.

- [ ] **Allow volunteers to remove saved home location**

  Profile can replace saved coordinates but offers no way to clear the address/ZIP and coordinates completely.

- [ ] **Define OTP challenge retention**

  Consumed and expired OTP challenges retain destination phone numbers indefinitely. Add a retention period and cleanup job.

- [ ] **Persist county-geocode misses**

  County geocoding records successful matches only. Mark unmatched and ambiguous attempts so reruns are resumable and do not repeatedly perform the same lookup.
npm run start:prod
