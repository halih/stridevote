# Follow-ups

Remaining work from the post-canvass review. Check an item when you want it next.

Jargon used below:

- **Wave** — a named canvass pass on a campaign (e.g. Primary vs General). Lists are published into a wave; knocks are stored against that wave.
- **Packet** — the walk list downloaded onto the phone (doors, script, survey, map points). Lives in IndexedDB for offline use.
- **Drawn turf** — a polygon an admin draws on the map. Membership is “whose geocoded address falls inside.”
- **Precinct turf** — cut by official precinct code from the voter file. Does not need coordinates to count doors.

---

## Field-test blockers

- [ ] **Stop sample stats when a user has no attempts**

  The Stats tab still shows made-up numbers (hundreds of doors, a fake leaderboard) until a volunteer has synced at least one knock. A first-time canvasser will think that is their real impact. Empty should look empty: zeros, and a short “no results yet” state.

- [ ] **One coordinate rule for drawn turfs (and generate from the nearby box, not the whole campaign)**

  Preview and generate do not always use the same lat/lng for a household (Census vs Mapbox). A door can look inside the polygon in the estimate and then get dropped (or the reverse) when the list is created. Drawn-turf create also loads every matching household in the campaign and then clips, which will time out on a real district. Preview already queries “households in this map box”; generate should do the same, and both should pick coordinates the same way (prefer stored Mapbox, else Census).

- [ ] **Don’t mix Census voting districts with official precincts**

  If WA precincts are not imported (or the campaign-voter join finds none), the turf map falls back to Census “voting districts.” Those look like precincts but their codes do not match the voter file, so you cannot cut a real precinct turf from them. Either hide that fallback in the same picker, or label it clearly as “geometry only / not voter-file precincts.”

- [ ] **Cap / warn Mapbox on packet download**

  When a volunteer opens a list, we may call Mapbox for every door that still has no stored pin. That is billed, can make download slow or fail, and doors that still have no pin just vanish from the map. Put a limit or a confirmation on those calls, and surface doors that stay unpinned instead of failing silently.

- [ ] **Restore prior answers when updating a door (and mark seed vs roommate)**

  Opening a door you already logged resets person outcomes and survey answers to “not home.” Volunteers will overwrite real data without meaning to. Reload the last answers. Also show which people were the original list targets vs other voters at the same address (`matchedSeed` is stored but not shown).

---

## Data / sync integrity

- [ ] **Freeze the walk snapshot after publish**

  Publishing a list into a wave is supposed to freeze who is on it. Packet download still copies extra doors from the live turf if the snapshot is shorter, so an admin who edits the turf mid-walk can change what a volunteer sees. Removed doors also stay on the old snapshot. Treat publish as freeze; if you need updates, add an explicit “republish this wave” action.

- [ ] **Compute “current knock” in the database**

  “What is the latest result at this door?” is calculated in app code by loading all attempts and folding them in memory. Fine for a demo list; slow and fragile once a wave has tens of thousands of knocks. Store a current flag, or answer it with one SQL query.

- [ ] **Decide what happens when two results collide**

  If a volunteer syncs after the list was released, or two phones log the same door, we currently accept the extra knock and mark it `staleCheckout` for admin. That may be right, or we may want to reject / last-write-wins. Pick a rule and make the volunteer UI say what happened, not only an admin footnote.

- [ ] **Watch lists are not tied to a wave**

  “Watch this list” is per list, not per wave. After Primary vs General, a watch can point at the wrong pass — or nobody uses watches at all. Either scope them to a wave, or remove the feature.

- [ ] **Voter data on the phone (IndexedDB)**

  Packets hold names, ages, addresses, and survey answers on the device for 72 hours. Decide whether that is acceptable for field use, then encrypt, shorten the TTL, and/or wipe on logout and when the list is completed.

---

## Product / UX for real walking

- [x] **Start walk order from volunteer GPS when available**

  Done. The packet can order doors from where the volunteer is standing instead of a generic map corner.

- [ ] **Ungeocoded doors on precinct walks should be obvious**

  Precinct turfs correctly include doors Census could not place (the voter file precinct is enough). On the walk those doors have no map pin, so they are easy to skip. Keep them on the list and mark them as “no map location” so people still knock them.

- [ ] **Hide MiniVAN / Civibyte “create list” unless you import**

  Admin can still type a MiniVAN number or Civibyte URL and create a list. That does not import doors into native knocking; it only stores a pointer. Hide or relabel that until a real import exists, so organizers are not surprised.

- [x] **Volunteer count from memberships, not a typed number**

  Done. Campaign “active volunteers” comes from who actually joined, not a number on the campaign form.

- [ ] **Batch precinct create: report each turf, not only the first error**

  Creating many precincts at once stops at the first failure message. If 18 of 20 succeed, the admin should see which two failed and why, and still keep the 18.

- [ ] **Warn when drawn polygons overlap**

  Two drawn turfs can contain the same door. Precinct-by-code lists do not overlap; freehand polygons can. Warn (or block) when a new polygon covers doors already on another list in the same wave.

---

## Cleanup (leftover)

- [ ] **Leaderboard helper vs `moved` in stats**

  `getAttemptLeaderboard` exists but nothing in the UI calls it (the page still has a sample board in some cases). Also `moved` is a real door outcome but is left out of the outcome bar chart. Either wire the real leaderboard and count `moved`, or delete the unused helper so stats cannot lie.

- [x] **One geometry-simplify helper**

  Done. District geocoding and precinct import no longer each have their own copy of the line-simplify math.

---

## Later / not blocking a WA precinct field test

- [ ] **Real polygon clip (or PostGIS)**

  When a precinct straddles the campaign district, we currently drop vertices that fall outside. That is not a true clip: the shape can go wrong or the precinct can become unselectable. Fine for a first WA test; replace before statewide use.

- [ ] **Real MiniVAN / Civibyte import**

  Checkout and “open in the other app” exist. Pulling those vendors’ doors/voters into StrideVote knocking does not.

- [ ] **Warn when a district has more than 400 precincts**

  The map loads at most 400 precincts and silently drops the rest. A large district can be missing precincts with no message.

- [ ] **Production map tiles**

  Default tiles are public OpenStreetMap. That is not a volume-production plan; set `NEXT_PUBLIC_MAP_TILE_URL` (or another provider) before lots of volunteers hit the map.
