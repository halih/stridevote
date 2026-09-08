import { prisma } from "@/lib/db";
import { parseProgramQuestions, snapshotListIntoProgram } from "@/lib/canvass/programs";
import {
  DOOR_OUTCOME_LABELS,
  type DoorOutcome,
  isDoneDoorOutcome,
} from "@/lib/canvass/outcomes";
import { getCurrentAttemptsForList } from "@/lib/canvass/progress";
import {
  resolveDoorCoords,
  type DoorCoordSource,
} from "@/lib/canvass/door-coords";
import { orderForStreetWalk } from "@/lib/canvass/walk-order";
import {
  geocodeMapboxForwardBatch,
  mapboxToken,
} from "@/lib/geocode-mapbox";

export interface FieldPacketDoor {
  householdId: string;
  sortOrder: number;
  address: string;
  addressLine: string;
  city: string;
  unit: string | null;
  lat: number | null;
  lng: number | null;
  coordSource: DoorCoordSource;
  stableLat: number | null;
  stableLng: number | null;
  /** Durable field layer for this household (cross-campaign). */
  field?: {
    accessStatus: string;
    observedScore: number | null;
    observedScoreAt: string | null;
  };
  voters: Array<{
    voterId: string;
    firstName: string;
    lastName: string;
    age: number | null;
    sex: string | null;
    matchedSeed: boolean;
    residenceStatus?: string;
    talkScore?: number | null;
    scoreUpdatedAt?: string | null;
    scoreSource?: string | null;
  }>;
  current: {
    clientAttemptId: string;
    outcome: string;
    outcomeLabel: string;
    closed: boolean;
    support: number | null;
    observedScore: number | null;
    capturedAt: string;
  } | null;
  history: Array<{
    programName: string;
    outcome: string;
    outcomeLabel: string;
    support: number | null;
    capturedAt: string;
  }>;
}

export interface FieldPacket {
  version: string;
  downloadedAt: string;
  listId: string;
  listName: string;
  source: string;
  doorsCount: number;
  programId: string;
  programName: string;
  campaignId: string;
  campaignName: string;
  campaignColor: string;
  checkoutId: string;
  script: string | null;
  questions: ReturnType<typeof parseProgramQuestions>;
  doors: FieldPacketDoor[];
}

function approxAge(yearOfBirth: number | null | undefined): number | null {
  if (yearOfBirth == null) return null;
  const age = new Date().getFullYear() - yearOfBirth;
  return age >= 0 && age < 130 ? age : null;
}

const packetVoterSelect = {
  id: true,
  firstName: true,
  lastName: true,
  yearOfBirth: true,
  gender: true,
  residenceStatus: true,
  talkScore: true,
  scoreUpdatedAt: true,
  scoreSource: true,
} as const;

const packetHouseholdInclude = {
  voters: {
    include: {
      voter: { select: packetVoterSelect },
    },
  },
} as const;

export async function buildFieldPacket(opts: {
  userId: string;
  listId: string;
  programId: string;
}): Promise<{ ok: true; packet: FieldPacket } | { ok: false; message: string }> {
  const checkout = await prisma.listCheckout.findFirst({
    where: {
      listId: opts.listId,
      programId: opts.programId,
      userId: opts.userId,
      status: "active",
    },
  });
  if (!checkout) {
    return { ok: false, message: "Check out this list before downloading." };
  }

  const link = await prisma.listCampaign.findFirst({
    where: {
      listId: opts.listId,
      programId: opts.programId,
      OR: [
        { visibility: "volunteers" },
        { visibility: "assigned", assignedUserId: opts.userId },
      ],
    },
    include: {
      list: true,
      program: true,
      campaign: true,
    },
  });
  if (!link) {
    return { ok: false, message: "List is not available in this program." };
  }

  // Imported lists (MiniVAN) carry their own doors, so they can be walked here.
  if (link.list.source !== "stridevote") {
    const importedDoors = await prisma.listHousehold.count({
      where: { listId: opts.listId },
    });
    if (!importedDoors) {
      return {
        ok: false,
        message: "Open this list in MiniVAN or Civibyte — it has no doors here to knock.",
      };
    }
  }

  let households = await prisma.programListHousehold.findMany({
    where: { programId: opts.programId, listId: opts.listId },
    orderBy: { sortOrder: "asc" },
    include: {
      household: {
        include: packetHouseholdInclude,
      },
    },
  });

  const liveHouseholdCount = await prisma.listHousehold.count({
    where: { listId: opts.listId },
  });

  // Incomplete or empty snapshots (e.g. published before members finished writing)
  // must not hide live doors — backfill then reload.
  if (households.length < liveHouseholdCount) {
    await snapshotListIntoProgram(opts.programId, opts.listId);
    households = await prisma.programListHousehold.findMany({
      where: { programId: opts.programId, listId: opts.listId },
      orderBy: { sortOrder: "asc" },
      include: {
        household: {
          include: packetHouseholdInclude,
        },
      },
    });
  }

  if (!households.length) {
    const live = await prisma.listHousehold.findMany({
      where: { listId: opts.listId },
      orderBy: { sortOrder: "asc" },
      include: {
        household: {
          include: packetHouseholdInclude,
        },
      },
    });
    households = live.map((row) => ({
      ...row,
      programId: opts.programId,
      createdAt: row.createdAt,
    })) as typeof households;
  }

  let programVoters = await prisma.programListVoter.findMany({
    where: { programId: opts.programId, listId: opts.listId },
    select: { voterId: true, matchedSeed: true },
  });
  const liveVoterCount = await prisma.listVoter.count({
    where: { listId: opts.listId },
  });
  if (programVoters.length < liveVoterCount) {
    await snapshotListIntoProgram(opts.programId, opts.listId);
    programVoters = await prisma.programListVoter.findMany({
      where: { programId: opts.programId, listId: opts.listId },
      select: { voterId: true, matchedSeed: true },
    });
  }
  if (!programVoters.length && liveVoterCount > 0) {
    programVoters = await prisma.listVoter.findMany({
      where: { listId: opts.listId },
      select: { voterId: true, matchedSeed: true },
    });
  }
  const matchedSeedByVoter = new Map(
    programVoters.map((v) => [v.voterId, v.matchedSeed]),
  );

  const current = await getCurrentAttemptsForList(opts.programId, opts.listId);

  // Campaign-wide history across other programs (summary only, no notes).
  const householdIds = households.map((h) => h.householdId);
  const historyAttempts =
    householdIds.length === 0
      ? []
      : await prisma.canvassAttempt.findMany({
          where: {
            campaignId: link.campaignId,
            householdId: { in: householdIds },
          },
          orderBy: { capturedAt: "desc" },
          select: {
            householdId: true,
            programId: true,
            clientAttemptId: true,
            supersedesClientId: true,
            outcome: true,
            capturedAt: true,
            program: { select: { name: true } },
            people: { select: { support: true, outcome: true } },
          },
        });

  const superseded = new Set(
    historyAttempts
      .map((a) => a.supersedesClientId)
      .filter((id): id is string => Boolean(id)),
  );

  const historyByHousehold = new Map<
    string,
    Array<{
      programName: string;
      outcome: string;
      outcomeLabel: string;
      support: number | null;
      capturedAt: string;
    }>
  >();

  const seenProgramHousehold = new Set<string>();
  for (const a of historyAttempts) {
    if (superseded.has(a.clientAttemptId)) continue;
    const key = `${a.householdId}:${a.programId}`;
    if (seenProgramHousehold.has(key)) continue;
    seenProgramHousehold.add(key);
    const talked = a.people.find((p) => p.outcome === "talked" && p.support != null);
    const list = historyByHousehold.get(a.householdId) ?? [];
    list.push({
      programName: a.program.name,
      outcome: a.outcome,
      outcomeLabel:
        DOOR_OUTCOME_LABELS[a.outcome as DoorOutcome] ?? a.outcome,
      support: talked?.support ?? null,
      capturedAt: a.capturedAt.toISOString(),
    });
    historyByHousehold.set(a.householdId, list);
  }

  const sessionByHousehold = await sessionMapboxOverlay(households);

  const doorsRaw: FieldPacketDoor[] = households.map((row) => {
    const h = row.household;
    const coords = resolveDoorCoords({
      lat: h.lat,
      lng: h.lng,
      geocodeSource: h.geocodeSource,
      session: sessionByHousehold.get(h.id) ?? null,
    });
    const cur = current.get(row.householdId);
    // Prefer voters on this list; if the membership map is empty or out of sync
    // with the household, still show everyone living at the door.
    const onList = h.voters.filter((hv) => matchedSeedByVoter.has(hv.voterId));
    const voters =
      matchedSeedByVoter.size === 0 || onList.length === 0 ? h.voters : onList;

    return {
      householdId: row.householdId,
      sortOrder: row.sortOrder,
      address: h.displayAddress,
      addressLine: h.addressLine,
      city: h.city,
      unit: h.unit,
      lat: coords.lat,
      lng: coords.lng,
      coordSource: coords.coordSource,
      stableLat: coords.stableLat,
      stableLng: coords.stableLng,
      field: {
        accessStatus: h.accessStatus,
        observedScore: h.observedScore,
        observedScoreAt: h.observedScoreAt?.toISOString() ?? null,
      },
      voters: voters.map((hv) => ({
        voterId: hv.voter.id,
        firstName: hv.voter.firstName,
        lastName: hv.voter.lastName,
        age: approxAge(hv.voter.yearOfBirth),
        sex: hv.voter.gender,
        matchedSeed: matchedSeedByVoter.get(hv.voterId) ?? false,
        residenceStatus: hv.voter.residenceStatus,
        talkScore: hv.voter.talkScore,
        scoreUpdatedAt: hv.voter.scoreUpdatedAt?.toISOString() ?? null,
        scoreSource: hv.voter.scoreSource,
      })),
      current: cur
        ? {
            clientAttemptId: cur.clientAttemptId,
            outcome: cur.outcome,
            outcomeLabel:
              DOOR_OUTCOME_LABELS[cur.outcome as DoorOutcome] ?? cur.outcome,
            // Any logged result is done; volunteers can update it again anytime.
            closed: isDoneDoorOutcome(cur.outcome),
            support: cur.support,
            observedScore: cur.observedScore,
            capturedAt: cur.capturedAt.toISOString(),
          }
        : null,
      history: historyByHousehold.get(row.householdId) ?? [],
    };
  });

  // Field packets walk street by street, so Next stays on the block instead of
  // hopping to whichever door happens to be a few feet closer.
  const doors = orderForStreetWalk(doorsRaw, {
    pointOf: (door) =>
      door.lat != null && door.lng != null
        ? { lat: door.lat, lng: door.lng }
        : null,
    addressOf: (door) => ({
      addressLine: door.addressLine,
      city: door.city,
      unit: door.unit,
    }),
  }).map((door, index) => ({ ...door, sortOrder: index }));

  const version = `${opts.programId}:${opts.listId}:${Date.now()}`;

  return {
    ok: true,
    packet: {
      version,
      downloadedAt: new Date().toISOString(),
      listId: link.list.id,
      listName: link.list.name,
      source: link.list.source,
      doorsCount: Math.max(doors.length, link.list.doorsCount),
      programId: link.program.id,
      programName: link.program.name,
      campaignId: link.campaign.id,
      campaignName: link.campaign.name,
      campaignColor: link.campaign.color,
      checkoutId: checkout.id,
      script: link.program.script,
      questions: parseProgramQuestions(link.program.questions),
      doors,
    },
  };
}

async function sessionMapboxOverlay(
  households: Array<{
    household: {
      id: string;
      addressLine: string;
      city: string;
      state: string;
      postalCode: string;
      lat: number | null;
      lng: number | null;
    };
  }>,
): Promise<Map<string, { lat: number; lng: number }>> {
  const overlay = new Map<string, { lat: number; lng: number }>();
  if (!mapboxToken()) return overlay;
  const needing = households.filter(
    (row) => row.household.lat == null || row.household.lng == null,
  );
  if (!needing.length) return overlay;
  const unique = new Map<
    string,
    { addressLine: string; city: string; state: string; postalCode: string }
  >();
  for (const row of needing) {
    const h = row.household;
    const key = `${h.addressLine}|${h.city}|${h.state}|${h.postalCode}`.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, {
        addressLine: h.addressLine,
        city: h.city,
        state: h.state,
        postalCode: h.postalCode,
      });
    }
  }
  try {
    const queries = [...unique.values()];
    const results = await geocodeMapboxForwardBatch(queries);
    const byKey = new Map<string, { lat: number; lng: number }>();
    queries.forEach((q, index) => {
      const hit = results[index];
      if (!hit) return;
      byKey.set(
        `${q.addressLine}|${q.city}|${q.state}|${q.postalCode}`.toLowerCase(),
        { lat: hit.lat, lng: hit.lng },
      );
    });
    for (const row of needing) {
      const h = row.household;
      const hit = byKey.get(
        `${h.addressLine}|${h.city}|${h.state}|${h.postalCode}`.toLowerCase(),
      );
      if (hit) overlay.set(h.id, hit);
    }
  } catch (err) {
    console.error("session Mapbox geocode failed", err);
  }
  return overlay;
}
