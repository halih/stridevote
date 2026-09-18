import "server-only";
import { prisma } from "@/lib/db";
import { orderForStreetWalk } from "@/lib/canvass/walk-order";
import { ensureActiveProgram, snapshotListIntoProgram } from "@/lib/canvass/programs";
import { normalizeHouseholdAddress } from "@/lib/household-address";
import { extractStreetNo, matchMinivanPeople } from "@/lib/minivan/match";
import { requireMinivanAdapter } from "@/lib/minivan/adapters";
import { completeMinivanJob, failMinivanJob } from "@/lib/minivan/jobs";
import { progressiveScoreFromLikelyParty } from "@/lib/canvass/progressive-score";
import { revalidatePath } from "next/cache";
import { expandExternalListVoters } from "@/lib/external-list-voters";

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "minivan-list";
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let n = 1;
  while (await prisma.list.findUnique({ where: { slug } })) {
    slug = `${base}-${++n}`;
  }
  return slug;
}

export interface MinivanImportPerson {
  vanId: number;
  firstName: string | null;
  middleName?: string | null;
  lastName: string | null;
  streetNo: string | null;
  streetPrefix?: string | null;
  streetName?: string | null;
  streetType?: string | null;
  streetSuffix?: string | null;
  aptNo?: string | null;
  city: string | null;
  state: string | null;
  zip5: string | null;
  fullAddress?: string | null;
  lat?: number | null;
  lng?: number | null;
  phones?: string[];
  emails?: string[];
  likelyParty?: string | null;
  homePhone?: string | null;
}

export interface MinivanImportPayload {
  printedListNumber: string;
  listId: number;
  listName?: string | null;
  people: MinivanImportPerson[];
}

function streetLine(p: MinivanImportPerson): string {
  if (p.fullAddress) return p.fullAddress.split(",")[0]?.trim() || p.fullAddress;
  const parts = [
    p.streetNo,
    p.streetPrefix,
    p.streetName,
    p.streetType,
    p.streetSuffix,
  ].filter(Boolean);
  let line = parts.join(" ");
  if (p.aptNo) line += ` #${p.aptNo}`;
  return line || "Unknown";
}

function mergeUnique(existing: string[], incoming: string[]): string[] {
  const set = new Set(existing.map((s) => s.trim()).filter(Boolean));
  for (const s of incoming) {
    const t = s.trim();
    if (t) set.add(t);
  }
  return [...set];
}

/**
 * Apply a MiniVAN people export: match-or-skip, enrich contacts, create a
 * native StrideVote list with ListVoter.vanId, snapshot into the active wave.
 */
export async function applyMinivanImport(
  jobId: string,
  payload: MinivanImportPayload,
): Promise<{ ok: boolean; error?: string; listId?: string; stats?: Record<string, number> }> {
  const job = await prisma.miniVanJob.findUnique({
    where: { id: jobId },
    include: {
      campaign: {
        select: {
          id: true,
          slug: true,
          minivanEnabled: true,
          minivanAdapterKey: true,
        },
      },
    },
  });
  if (!job || job.type !== "import_list" || job.status !== "running") {
    return { ok: false, error: "Job not found or not running" };
  }
  if (!job.campaign.minivanEnabled) {
    await failMinivanJob(jobId, "MiniVAN disabled for campaign");
    return { ok: false, error: "MiniVAN disabled" };
  }

  try {
    requireMinivanAdapter(job.campaign.minivanAdapterKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Adapter error";
    await failMinivanJob(jobId, msg);
    return { ok: false, error: msg };
  }

  const jobPayload = (job.payload ?? {}) as { name?: string; printedListNumber?: string };
  const listName =
    jobPayload.name?.trim() ||
    payload.listName?.trim() ||
    `MiniVAN ${payload.printedListNumber}`;
  const printed =
    jobPayload.printedListNumber || payload.printedListNumber;

  const existingForSource = await prisma.list.findFirst({
    where: {
      source: "minivan",
      sourceRef: printed,
      deletedAt: null,
    },
    select: { id: true, name: true },
  });
  if (existingForSource) {
    const msg = `MiniVAN list ${printed} is already imported as "${existingForSource.name}". Split that list instead of importing again.`;
    await failMinivanJob(jobId, msg);
    return { ok: false, error: msg };
  }

  // Candidates: campaign voters + any voter whose address could match (campaign-scoped preferred).
  const campaignVoters = await prisma.campaignVoter.findMany({
    where: { campaignId: job.campaignId },
    select: {
      voter: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          registrationAddress: true,
          postalCode: true,
          phones: true,
          emails: true,
          likelyParty: true,
          talkScore: true,
        },
      },
    },
  });

  let voterPool = campaignVoters.map((cv) => cv.voter);
  if (!voterPool.length) {
    // Fallback: match against all voters (import may run before syncCampaignVoters).
    voterPool = await prisma.voter.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        registrationAddress: true,
        postalCode: true,
        phones: true,
        emails: true,
        likelyParty: true,
        talkScore: true,
      },
      take: 500000,
    });
  }

  const candidates = voterPool.map((v) => ({
    id: v.id,
    firstName: v.firstName,
    lastName: v.lastName,
    streetNo: extractStreetNo(v.registrationAddress),
    postalCode: v.postalCode,
  }));

  const { mapping, stats } = matchMinivanPeople(
    payload.people.map((p) => ({
      vanId: p.vanId,
      firstName: p.firstName,
      lastName: p.lastName,
      streetNo: p.streetNo,
      zip5: p.zip5,
    })),
    candidates,
  );

  const peopleByVan = new Map(payload.people.map((p) => [p.vanId, p]));
  const matchedVanIds = [...mapping.keys()];

  // Enrich matched voters with phones/emails; map likely party → progressive score.
  const enrichedAt = new Date();
  for (const vanId of matchedVanIds) {
    const voterId = mapping.get(vanId)!;
    const person = peopleByVan.get(vanId)!;
    const existing = voterPool.find((v) => v.id === voterId);
    if (!existing) continue;
    const phones = mergeUnique(existing.phones ?? [], [
      ...(person.phones ?? []),
      ...(person.homePhone ? [person.homePhone] : []),
    ]);
    const emails = mergeUnique(existing.emails ?? [], person.emails ?? []);
    const likelyParty =
      person.likelyParty?.trim() || existing.likelyParty || null;
    const fromParty = progressiveScoreFromLikelyParty(likelyParty);
    const data: {
      phones: string[];
      emails: string[];
      likelyParty: string | null;
      talkScore?: number;
      scoreUpdatedAt?: Date;
      scoreSource?: string;
    } = { phones, emails, likelyParty };
    // Seed progressive score from VAN only when we don't already have one.
    if (fromParty != null && existing.talkScore == null) {
      data.talkScore = fromParty;
      data.scoreUpdatedAt = enrichedAt;
      data.scoreSource = "import";
    }
    await prisma.voter.update({
      where: { id: voterId },
      data,
    });
  }

  // Group matched people by household (MiniVAN address + existing household link).
  const voterIds = [...new Set(mapping.values())];
  const householdLinks = await prisma.householdVoter.findMany({
    where: { voterId: { in: voterIds } },
    select: { voterId: true, householdId: true },
  });
  const voterToHh = new Map(householdLinks.map((h) => [h.voterId, h.householdId]));

  // Ensure every matched voter has a household; create from MiniVAN address if needed.
  const doorBuckets = new Map<
    string,
    { householdId: string; voterIds: string[]; vanIds: number[]; sortKey: { addressLine: string; city: string; unit: string | null; lat: number | null; lng: number | null } }
  >();

  for (const vanId of matchedVanIds) {
    const voterId = mapping.get(vanId)!;
    const person = peopleByVan.get(vanId)!;
    let householdId = voterToHh.get(voterId);
    const addr = normalizeHouseholdAddress({
      registrationAddress: streetLine(person),
      city: person.city ?? "",
      state: person.state ?? "WA",
      postalCode: person.zip5 ?? "",
    });

    if (!householdId) {
      const existingHh = await prisma.household.findUnique({
        where: { normalizedKey: addr.normalizedKey },
      });
      if (existingHh) {
        householdId = existingHh.id;
        await prisma.householdVoter.upsert({
          where: { voterId },
          create: { householdId, voterId },
          update: {},
        });
      } else {
        const created = await prisma.household.create({
          data: {
            normalizedKey: addr.normalizedKey,
            displayAddress: addr.displayAddress,
            addressLine: addr.addressLine,
            city: addr.city,
            state: addr.state,
            postalCode: addr.postalCode,
            unit: addr.unit,
            lat: person.lat ?? null,
            lng: person.lng ?? null,
            geocodeSource: person.lat != null ? "minivan" : null,
            geocodeStatus: person.lat != null ? "matched" : "pending",
          },
        });
        householdId = created.id;
        await prisma.householdVoter.create({
          data: { householdId, voterId },
        });
      }
      voterToHh.set(voterId, householdId);
    }

    const bucket = doorBuckets.get(householdId) ?? {
      householdId,
      voterIds: [],
      vanIds: [],
      sortKey: {
        addressLine: addr.addressLine,
        city: addr.city,
        unit: addr.unit,
        lat: person.lat ?? null,
        lng: person.lng ?? null,
      },
    };
    if (!bucket.voterIds.includes(voterId)) bucket.voterIds.push(voterId);
    bucket.vanIds.push(vanId);
    doorBuckets.set(householdId, bucket);
  }

  type DoorBucket = {
    householdId: string;
    voterIds: string[];
    vanIds: number[];
    sortKey: {
      addressLine: string;
      city: string;
      unit: string | null;
      lat: number | null;
      lng: number | null;
    };
  };

  const doors: DoorBucket[] = [...doorBuckets.values()];
  const ordered = orderForStreetWalk(doors, {
    addressOf: (d) => ({
      addressLine: d.sortKey.addressLine,
      city: d.sortKey.city,
      unit: d.sortKey.unit,
    }),
    pointOf: (d) =>
      d.sortKey.lat != null && d.sortKey.lng != null
        ? { lat: d.sortKey.lat, lng: d.sortKey.lng }
        : null,
  });
  const householdMemberLinks = await prisma.householdVoter.findMany({
    where: {
      householdId: { in: ordered.map((door) => door.householdId) },
      voter: {
        campaignLinks: { some: { campaignId: job.campaignId } },
      },
    },
    select: { voterId: true },
  });
  const expandedVoterRows = expandExternalListVoters(
    matchedVanIds.map((vanId) => ({
      voterId: mapping.get(vanId)!,
      vanId,
    })),
    householdMemberLinks.map((link) => link.voterId),
  );
  const expandedVoterIds = expandedVoterRows.map((row) => row.voterId);

  const program = await ensureActiveProgram(job.campaignId);
  const slug = await uniqueSlug(slugify(listName));

  let centroidLat: number | null = null;
  let centroidLng: number | null = null;
  const withCoords = ordered.filter((d) => d.sortKey.lat != null && d.sortKey.lng != null);
  if (withCoords.length) {
    centroidLat =
      withCoords.reduce((s, d) => s + (d.sortKey.lat as number), 0) / withCoords.length;
    centroidLng =
      withCoords.reduce((s, d) => s + (d.sortKey.lng as number), 0) / withCoords.length;
  }

  const list = await prisma.list.create({
    data: {
      slug,
      name: listName,
      source: "minivan",
      sourceRef: printed,
      doorsCount: ordered.length,
      centroidLat,
      centroidLng,
      data: {
        minivan: {
          printedListNumber: printed,
          listId: payload.listId,
          importedAt: new Date().toISOString(),
          importStats: {
            people: payload.people.length,
            ...stats,
            doors: ordered.length,
            voters: expandedVoterRows.length,
          },
        },
      },
      campaignLinks: {
        create: [{ campaignId: job.campaignId, programId: program.id }],
      },
      households: {
        create: ordered.map((d, i) => ({
          householdId: d.householdId,
          sortOrder: i,
        })),
      },
      voters: {
        create: expandedVoterRows,
      },
    },
  });

  // Link matched voters to campaign if missing.
  if (expandedVoterIds.length) {
    await prisma.campaignVoter.createMany({
      data: expandedVoterIds.map((voterId) => ({
        campaignId: job.campaignId,
        voterId,
      })),
      skipDuplicates: true,
    });
  }

  await snapshotListIntoProgram(program.id, list.id);

  await prisma.miniVanJob.update({
    where: { id: jobId },
    data: { listId: list.id },
  });

  const result = {
    listId: list.id,
    doors: ordered.length,
    voters: expandedVoterRows.length,
    stats,
  };
  await completeMinivanJob(jobId, result);

  revalidatePath("/admin");
  revalidatePath(`/admin/${job.campaign.slug}`);
  revalidatePath("/canvass");

  return {
    ok: true,
    listId: list.id,
    stats: {
      ...stats,
      doors: ordered.length,
      voters: expandedVoterRows.length,
    },
  };
}
