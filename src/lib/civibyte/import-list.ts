import "server-only";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";
import {
  ensureActiveProgram,
  snapshotListIntoProgram,
} from "@/lib/canvass/programs";
import { normalizeHouseholdAddress } from "@/lib/household-address";
import { importedGeocodeWrite } from "@/lib/household-coords";
import { pullCivibyteSession } from "@/lib/civibyte/client";
import {
  parseCivibyteAddress,
  type CivibyteDoorLink,
  type CivibyteListMeta,
} from "@/lib/civibyte/map";

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "civibyte-list";
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let n = 1;
  while (await prisma.list.findUnique({ where: { slug } })) {
    slug = `${base}-${++n}`;
  }
  return slug;
}

export async function importCivibyteList(input: {
  campaignId: string;
  name: string;
  link: string;
}): Promise<{
  listId: string;
  doors: number;
  voters: number;
  unmatchedDoors: number;
  unmatchedVoters: number;
}> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: input.campaignId },
    select: {
      id: true,
      slug: true,
      civibyteEnabled: true,
    },
  });
  if (!campaign) throw new Error("Campaign not found.");
  if (!campaign.civibyteEnabled)
    throw new Error("Civibyte is not enabled for this campaign.");
  const phoneNumber = process.env.CIVIBYTE_GUEST_PHONE;
  if (!phoneNumber) {
    throw new Error("Set CIVIBYTE_GUEST_PHONE before importing.");
  }

  const existingForSource = await prisma.list.findFirst({
    where: {
      source: "civibyte",
      sourceRef: input.link,
      deletedAt: null,
    },
    select: { id: true, name: true },
  });
  if (existingForSource) {
    throw new Error(
      `This Civibyte link is already imported as "${existingForSource.name}". Split that list instead of importing again.`,
    );
  }

  const session = await pullCivibyteSession({
    link: input.link,
    phoneNumber,
    name: process.env.CIVIBYTE_GUEST_NAME,
  });
  const sourceVoters = Object.values(session.votersById);
  const stateVoterIds = sourceVoters.flatMap((voter) =>
    voter.stateVoterId ? [voter.stateVoterId] : [],
  );
  const localVoters = await prisma.voter.findMany({
    where: { stateVoterId: { in: stateVoterIds } },
    select: { id: true, stateVoterId: true },
  });
  const localByStateId = new Map(
    localVoters.map((voter) => [voter.stateVoterId, voter.id]),
  );
  const program = await ensureActiveProgram(campaign.id);
  const slug = await uniqueSlug(slugify(input.name));

  const result = await prisma.$transaction(
    async (tx) => {
      const doorLinks: Record<string, CivibyteDoorLink> = {};
      const householdRows: Array<{ householdId: string; sortOrder: number }> =
        [];
      const listVoterIds = new Set<string>();
      let unmatchedDoors = 0;
      let unmatchedVoters = 0;

      for (const door of session.sessionDoors) {
        const voterIdsByPk: Record<string, string> = {};
        for (const voterPk of door.voterPks) {
          const source = session.votersById[voterPk];
          const voterId = source?.stateVoterId
            ? localByStateId.get(source.stateVoterId)
            : undefined;
          if (!voterId) {
            unmatchedVoters += 1;
            continue;
          }
          voterIdsByPk[voterPk] = voterId;
          listVoterIds.add(voterId);
        }
        if (!Object.keys(voterIdsByPk).length) {
          unmatchedDoors += 1;
          continue;
        }

        const rawAddress =
          door.completeAddress || door.buildingAddress || "Unknown";
        const normalized = normalizeHouseholdAddress(
          parseCivibyteAddress(rawAddress),
        );
        const existing = await tx.household.findUnique({
          where: { normalizedKey: normalized.normalizedKey },
          select: { lat: true, lng: true, geocodeSource: true },
        });
        const geocode = importedGeocodeWrite({
          current: existing,
          lat: door.latitude,
          lng: door.longitude,
          source: "civibyte",
        });
        const household = await tx.household.upsert({
          where: { normalizedKey: normalized.normalizedKey },
          create: {
            ...normalized,
            lat: door.latitude,
            lng: door.longitude,
            geocodeSource: "civibyte",
            geocodeStatus: "matched",
          },
          update: {
            displayAddress: normalized.displayAddress,
            ...(geocode ?? {}),
          },
          select: { id: true },
        });

        for (const voterId of Object.values(voterIdsByPk)) {
          await tx.householdVoter.upsert({
            where: { voterId },
            create: { householdId: household.id, voterId },
            update: { householdId: household.id },
          });
        }
        const sortOrder = householdRows.length;
        if (!householdRows.some((row) => row.householdId === household.id)) {
          householdRows.push({ householdId: household.id, sortOrder });
        }
        doorLinks[door.id] = {
          addressPk: door.addressPk,
          householdId: household.id,
          voterIdsByPk,
        };
      }

      if (!householdRows.length) {
        throw new Error(
          "No Civibyte voters matched StrideVote by state voter ID. Import or sync the voter file first.",
        );
      }

      const voterIds = [...listVoterIds];
      const meta: CivibyteListMeta = {
        sessionId: session.canvassingSessionId,
        importedAt: new Date().toISOString(),
        importStats: {
          doors: householdRows.length,
          voters: voterIds.length,
          unmatchedDoors,
          unmatchedVoters,
        },
        doors: doorLinks,
      };
      const centroidLat =
        session.sessionDoors.reduce((sum, door) => sum + door.latitude, 0) /
        session.sessionDoors.length;
      const centroidLng =
        session.sessionDoors.reduce((sum, door) => sum + door.longitude, 0) /
        session.sessionDoors.length;

      const list = await tx.list.create({
        data: {
          slug,
          name: input.name,
          source: "civibyte",
          sourceRef: input.link,
          doorsCount: householdRows.length,
          centroidLat,
          centroidLng,
          data: { civibyte: meta } as unknown as Prisma.InputJsonValue,
          campaignLinks: {
            create: [{ campaignId: campaign.id, programId: program.id }],
          },
          households: { create: householdRows },
          voters: {
            create: voterIds.map((voterId) => ({ voterId, matchedSeed: true })),
          },
        },
      });
      await tx.campaignVoter.createMany({
        data: voterIds.map((voterId) => ({ campaignId: campaign.id, voterId })),
        skipDuplicates: true,
      });
      return {
        listId: list.id,
        doors: householdRows.length,
        voters: voterIds.length,
        unmatchedDoors,
        unmatchedVoters,
      };
    },
    { timeout: 30_000 },
  );

  await snapshotListIntoProgram(program.id, result.listId);
  revalidatePath("/admin");
  revalidatePath(`/admin/${campaign.slug}`);
  revalidatePath("/canvass");
  return result;
}
