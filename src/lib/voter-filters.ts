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
  page: z.string().optional(),
});

export type VoterFilters = z.infer<typeof voterFiltersSchema>;

/** Filters persisted on SavedVoterFilter — page is never stored. */
export type PersistableVoterFilters = Omit<VoterFilters, "page">;

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
    page: one(raw.page),
  });
}

export function buildVoterWhere(
  campaignId: string,
  filters: VoterFilters,
  now = new Date(),
): { where: Prisma.VoterWhereInput; filtered: boolean; page: number } {
  const query = filters.query?.trim();
  const minAge = positiveInt(filters.minAge);
  const maxAge = positiveInt(filters.maxAge);
  const votedOn = electionDate(filters.election);
  const currentYear = now.getFullYear();
  const page = Math.max(1, positiveInt(filters.page) ?? 1);
  const registeredAfter = registeredWithinPastYear(now);

  const campaignScope: Prisma.VoterWhereInput = {
    campaignLinks: { some: { campaignId } },
  };

  const audience: Prisma.VoterWhereInput[] = [];
  if (filters.likelyPrimary === "1") audience.push({ likelyPrimary: true });
  if (filters.likelyGeneral === "1") audience.push({ likelyGeneral: true });
  if (filters.newVoter === "1") {
    audience.push({ registrationDate: { gte: registeredAfter } });
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
      ...(filters.precinct ? [{ precinctCode: filters.precinct }] : []),
      ...(filters.gender ? [{ gender: filters.gender }] : []),
      ...(votedOn ? [{ history: { some: { electionDate: votedOn } } }] : []),
      ...(audience.length ? [{ OR: audience }] : []),
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
