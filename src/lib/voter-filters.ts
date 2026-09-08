import { z } from "zod";
import type { Prisma } from "@/generated/prisma";

export const voterFiltersSchema = z.object({
  query: z.string().optional(),
  precinct: z.string().optional(),
  gender: z.string().optional(),
  minAge: z.string().optional(),
  maxAge: z.string().optional(),
  election: z.string().optional(),
  likelyPrimary: z.string().optional(),
  likelyGeneral: z.string().optional(),
  newVoter: z.string().optional(),
  noApartments: z.string().optional(),
  /** Active canvass program / wave used for canvass filters + history. */
  programId: z.string().optional(),
  /** Include voters at doors with any current result in the program. */
  canvassed: z.string().optional(),
  /** Exclude voters at doors with any current result in the program. */
  excludeCanvassed: z.string().optional(),
  /** Exclude doors marked inaccessible in this campaign or on the master field layer. */
  excludeInaccessible: z.string().optional(),
  /** Exclude doors marked unsafe in this campaign or on the master field layer. */
  excludeUnsafe: z.string().optional(),
  /** Exclude voters marked moved on the master field layer. */
  excludeMoved: z.string().optional(),
  /** Exclude voters whose current progressive score is Republican (0). */
  excludeRepublicans: z.string().optional(),
  page: z.string().optional(),
});

export type VoterFilters = z.infer<typeof voterFiltersSchema>;

/** Filters persisted on SavedVoterFilter — page is never stored. */
export type PersistableVoterFilters = Omit<VoterFilters, "page">;

/** Household ids derived from current program attempts (door-level). */
export type CanvassAudienceIds = {
  canvassedHouseholdIds: readonly string[];
  inaccessibleHouseholdIds: readonly string[];
  unsafeHouseholdIds: readonly string[];
};

const FILTER_KEYS = [
  "query",
  "precinct",
  "gender",
  "minAge",
  "maxAge",
  "election",
  "likelyPrimary",
  "likelyGeneral",
  "newVoter",
  "noApartments",
  "programId",
  "canvassed",
  "excludeCanvassed",
  "excludeInaccessible",
  "excludeUnsafe",
  "excludeMoved",
  "excludeRepublicans",
] as const;

function positiveInt(value: string | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function electionDate(value: string | undefined): Date | null {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return new Date(`${trimmed}T00:00:00.000Z`);
}

export function registeredWithinPastYear(now = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate()),
  );
}

export function sanitizeVoterFilters(input: unknown): PersistableVoterFilters {
  const parsed = voterFiltersSchema.safeParse(input ?? {});
  const raw = parsed.success ? parsed.data : {};
  const out: PersistableVoterFilters = {};
  for (const key of FILTER_KEYS) {
    const value = raw[key]?.trim();
    if (value) out[key] = value;
  }
  return out;
}

export function filtersAreActive(filters: VoterFilters): boolean {
  const cleaned = sanitizeVoterFilters(filters);
  return Object.keys(cleaned).length > 0;
}

export function needsCanvassAudience(filters: VoterFilters): boolean {
  return (
    filters.canvassed === "1" ||
    filters.excludeCanvassed === "1" ||
    filters.excludeInaccessible === "1" ||
    filters.excludeUnsafe === "1"
  );
}

export function filtersToSearchParams(filters: VoterFilters): URLSearchParams {
  const params = new URLSearchParams();
  const cleaned = sanitizeVoterFilters(filters);
  for (const [key, value] of Object.entries(cleaned)) {
    if (value) params.set(key, value);
  }
  if (filters.page?.trim()) params.set("page", filters.page.trim());
  return params;
}

export function searchParamsToFilters(
  raw: Record<string, string | string[] | undefined>,
): VoterFilters {
  const one = (value: string | string[] | undefined): string =>
    Array.isArray(value) ? value[0] ?? "" : value ?? "";
  return sanitizeVoterFilters({
    query: one(raw.query),
    precinct: one(raw.precinct),
    gender: one(raw.gender),
    minAge: one(raw.minAge),
    maxAge: one(raw.maxAge),
    election: one(raw.election),
    likelyPrimary: one(raw.likelyPrimary),
    likelyGeneral: one(raw.likelyGeneral),
    newVoter: one(raw.newVoter),
    noApartments: one(raw.noApartments),
    programId: one(raw.programId),
    canvassed: one(raw.canvassed),
    excludeCanvassed: one(raw.excludeCanvassed),
    excludeInaccessible: one(raw.excludeInaccessible),
    excludeUnsafe: one(raw.excludeUnsafe),
    excludeMoved: one(raw.excludeMoved),
    excludeRepublicans: one(raw.excludeRepublicans),
    page: one(raw.page),
  });
}

function apartmentResidenceWhere(): Prisma.VoterWhereInput {
  const addressLooksMultiUnit: Prisma.VoterWhereInput = {
    OR: [
      { registrationAddress: { contains: "APT", mode: "insensitive" } },
      { registrationAddress: { contains: "APARTMENT", mode: "insensitive" } },
      { registrationAddress: { contains: " UNIT", mode: "insensitive" } },
      { registrationAddress: { contains: "UNIT ", mode: "insensitive" } },
      { registrationAddress: { contains: "STE ", mode: "insensitive" } },
      { registrationAddress: { contains: "SUITE", mode: "insensitive" } },
      { registrationAddress: { contains: "#", mode: "insensitive" } },
    ],
  };
  return {
    OR: [
      { householdLinks: { some: { household: { unit: { not: null } } } } },
      { AND: [{ householdLinks: { none: {} } }, addressLooksMultiUnit] },
    ],
  };
}

function atHouseholds(ids: readonly string[]): Prisma.VoterWhereInput {
  if (!ids.length) return { id: { in: [] } };
  return {
    householdLinks: { some: { householdId: { in: [...ids] } } },
  };
}

function excludeCampaignOrMasterAccess(
  status: "inaccessible" | "unsafe",
  campaignHouseholdIds: readonly string[] | undefined,
): Prisma.VoterWhereInput {
  const or: Prisma.VoterWhereInput[] = [
    {
      householdLinks: {
        some: { household: { accessStatus: status } },
      },
    },
  ];
  if (campaignHouseholdIds?.length) {
    or.push(atHouseholds(campaignHouseholdIds));
  }
  return { NOT: { OR: or } };
}

export function buildVoterWhere(
  campaignId: string,
  filters: VoterFilters,
  now = new Date(),
  canvass: CanvassAudienceIds | null = null,
): { where: Prisma.VoterWhereInput; filtered: boolean; page: number } {
  const query = filters.query?.trim();
  const minAge = positiveInt(filters.minAge);
  const maxAge = positiveInt(filters.maxAge);
  const votedOn = electionDate(filters.election);
  const currentYear = now.getFullYear();
  const page = Math.max(1, positiveInt(filters.page) ?? 1);
  const registeredAfter = registeredWithinPastYear(now);
  const precinctParts = filters.precinct?.split(":");
  const precinctWhere: Prisma.VoterWhereInput | null = filters.precinct
    ? precinctParts?.length === 2
      ? { countyCode: precinctParts[0], precinctCode: precinctParts[1] }
      : { precinctCode: filters.precinct }
    : null;

  const campaignScope: Prisma.VoterWhereInput = {
    campaignLinks: { some: { campaignId } },
  };

  const audience: Prisma.VoterWhereInput[] = [];
  if (filters.likelyPrimary === "1") audience.push({ likelyPrimary: true });
  if (filters.likelyGeneral === "1") audience.push({ likelyGeneral: true });
  if (filters.newVoter === "1") {
    audience.push({ registrationDate: { gte: registeredAfter } });
  }
  if (filters.canvassed === "1") {
    audience.push(atHouseholds(canvass?.canvassedHouseholdIds ?? []));
  }

  const where: Prisma.VoterWhereInput = {
    AND: [
      campaignScope,
      ...(query
        ? [
            {
              OR: [
                { firstName: { contains: query, mode: "insensitive" as const } },
                { lastName: { contains: query, mode: "insensitive" as const } },
                { stateVoterId: { contains: query, mode: "insensitive" as const } },
                {
                  registrationAddress: {
                    contains: query,
                    mode: "insensitive" as const,
                  },
                },
              ],
            },
          ]
        : []),
      ...(precinctWhere ? [precinctWhere] : []),
      ...(filters.gender ? [{ gender: filters.gender }] : []),
      ...(votedOn ? [{ history: { some: { electionDate: votedOn } } }] : []),
      ...(audience.length ? [{ OR: audience }] : []),
      ...(filters.noApartments === "1" ? [{ NOT: apartmentResidenceWhere() }] : []),
      ...(filters.excludeCanvassed === "1" &&
      (canvass?.canvassedHouseholdIds.length ?? 0) > 0
        ? [{ NOT: atHouseholds(canvass!.canvassedHouseholdIds) }]
        : []),
      ...(filters.excludeInaccessible === "1"
        ? [
            excludeCampaignOrMasterAccess(
              "inaccessible",
              canvass?.inaccessibleHouseholdIds,
            ),
          ]
        : []),
      ...(filters.excludeUnsafe === "1"
        ? [excludeCampaignOrMasterAccess("unsafe", canvass?.unsafeHouseholdIds)]
        : []),
      ...(filters.excludeMoved === "1"
        ? [{ NOT: { residenceStatus: "moved" } }]
        : []),
      ...(filters.excludeRepublicans === "1"
        ? [
            {
              // Written as positive matches so unscored voters are kept:
              // a SQL NOT over `talkScore = 0` drops every NULL row.
              OR: [
                { talkScore: { gt: 0 } },
                {
                  AND: [
                    { talkScore: null },
                    {
                      householdLinks: {
                        none: { household: { observedScore: 0 } },
                      },
                    },
                  ],
                },
              ],
            },
          ]
        : []),
      // Canvass include/exclude without audience data should match nothing / no-op.
      ...(filters.canvassed === "1" && !canvass
        ? [{ id: { in: [] } }]
        : []),
      ...(minAge != null || maxAge != null
        ? [
            {
              yearOfBirth: {
                ...(minAge != null ? { lte: currentYear - minAge } : {}),
                ...(maxAge != null ? { gte: currentYear - maxAge } : {}),
              },
            },
          ]
        : []),
    ],
  };

  return {
    where,
    filtered: filtersAreActive(filters),
    page,
  };
}
