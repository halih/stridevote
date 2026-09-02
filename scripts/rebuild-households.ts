/**
 * Idempotent household rebuild from voter registration addresses.
 *
 * Usage:
 *   npm run households:rebuild
 *   npm run households:rebuild -- --campaign count-binface
 */
import { PrismaClient } from "../src/generated/prisma";
import { normalizeHouseholdAddress } from "../src/lib/household-address";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const campaignIdx = args.indexOf("--campaign");
  const campaignSlug =
    campaignIdx >= 0 ? args[campaignIdx + 1] : undefined;

  const where = campaignSlug
    ? {
        campaignLinks: {
          some: { campaign: { slug: campaignSlug } },
        },
      }
    : {};

  const voters = await prisma.voter.findMany({
    where,
    select: {
      id: true,
      registrationAddress: true,
      city: true,
      state: true,
      postalCode: true,
    },
  });

  console.log(`Rebuilding households for ${voters.length.toLocaleString()} voters…`);

  const byKey = new Map<
    string,
    {
      normalized: ReturnType<typeof normalizeHouseholdAddress>;
      voterIds: string[];
    }
  >();

  for (const voter of voters) {
    const normalized = normalizeHouseholdAddress(voter);
    const entry = byKey.get(normalized.normalizedKey);
    if (entry) entry.voterIds.push(voter.id);
    else byKey.set(normalized.normalizedKey, { normalized, voterIds: [voter.id] });
  }

  const keys = [...byKey.values()];
  const chunkSize = 500;
  let linked = 0;

  for (let offset = 0; offset < keys.length; offset += chunkSize) {
    const chunk = keys.slice(offset, offset + chunkSize);
    await prisma.$transaction(
      chunk.map(({ normalized }) =>
        prisma.household.upsert({
          where: { normalizedKey: normalized.normalizedKey },
          create: {
            normalizedKey: normalized.normalizedKey,
            displayAddress: normalized.displayAddress,
            addressLine: normalized.addressLine,
            city: normalized.city,
            state: normalized.state,
            postalCode: normalized.postalCode,
            unit: normalized.unit,
          },
          update: {
            displayAddress: normalized.displayAddress,
            addressLine: normalized.addressLine,
            city: normalized.city,
            state: normalized.state,
            postalCode: normalized.postalCode,
            unit: normalized.unit,
          },
        }),
      ),
    );

    const households = await prisma.household.findMany({
      where: {
        normalizedKey: { in: chunk.map((row) => row.normalized.normalizedKey) },
      },
      select: { id: true, normalizedKey: true },
    });
    const idByKey = new Map(households.map((h) => [h.normalizedKey, h.id]));

    const linkRows = chunk.flatMap(({ normalized, voterIds }) => {
      const householdId = idByKey.get(normalized.normalizedKey);
      if (!householdId) return [];
      return voterIds.map((voterId) => ({ householdId, voterId }));
    });

    for (let i = 0; i < linkRows.length; i += chunkSize) {
      const linkChunk = linkRows.slice(i, i + chunkSize);
      await prisma.$transaction(
        linkChunk.map((row) =>
          prisma.householdVoter.upsert({
            where: { voterId: row.voterId },
            create: row,
            update: { householdId: row.householdId },
          }),
        ),
      );
      linked += linkChunk.length;
    }

    console.log(
      `  … ${Math.min(offset + chunk.length, keys.length).toLocaleString()} / ${keys.length.toLocaleString()} keys`,
    );
  }

  const coverage = await prisma.household.groupBy({
    by: ["geocodeStatus"],
    _count: true,
  });

  console.log(
    `Done. ${keys.length.toLocaleString()} households, ${linked.toLocaleString()} voter links.`,
  );
  console.log(
    "Geocode coverage:",
    coverage.map((row) => `${row.geocodeStatus}=${row._count}`).join(", ") || "none",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
