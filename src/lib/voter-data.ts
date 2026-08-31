import "server-only";

import { prisma } from "@/lib/db";
import { can } from "@/lib/authz";
import type { Prisma, User } from "@/generated/prisma";

export interface VoterFilters {
  query?: string;
  precinct?: string;
  gender?: string;
  minAge?: string;
  maxAge?: string;
  election?: string;
  page?: string;
}

export interface VoterDirectoryRow {
  id: string;
  stateVoterId: string;
  name: string;
  yearOfBirth: number | null;
  gender: string | null;
  address: string;
  precinct: string | null;
  registrationDate: string | null;
  electionsVoted: string[];
}

export interface CampaignVoterDirectory {
  campaign: { id: string; slug: string; name: string; district: string };
  voters: VoterDirectoryRow[];
  total: number;
  page: number;
  pageSize: number;
  precincts: string[];
  genders: string[];
  elections: string[];
}

const PAGE_SIZE = 50;

function positiveInt(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export async function getCampaignVoterDirectory(
  slug: string,
  user: User,
  filters: VoterFilters,
): Promise<CampaignVoterDirectory | null> {
  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, district: true },
  });
  if (!campaign || !(await can(user, campaign.id, "voters:view"))) return null;

  const query = filters.query?.trim();
  const minAge = positiveInt(filters.minAge);
  const maxAge = positiveInt(filters.maxAge);
  const currentYear = new Date().getFullYear();
  const page = Math.max(1, positiveInt(filters.page) ?? 1);

  const where: Prisma.VoterWhereInput = {
    campaignLinks: { some: { campaignId: campaign.id } },
    ...(query
      ? {
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
        }
      : {}),
    ...(filters.precinct ? { precinctCode: filters.precinct } : {}),
    ...(filters.gender ? { gender: filters.gender } : {}),
    ...(filters.election
      ? { electionsVoted: { has: filters.election } }
      : {}),
    ...(minAge != null || maxAge != null
      ? {
          yearOfBirth: {
            ...(minAge != null ? { lte: currentYear - minAge } : {}),
            ...(maxAge != null ? { gte: currentYear - maxAge } : {}),
          },
        }
      : {}),
  };

  const campaignScope: Prisma.VoterWhereInput = {
    campaignLinks: { some: { campaignId: campaign.id } },
  };
  const [voters, total, optionRows] = await Promise.all([
    prisma.voter.findMany({
      where,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.voter.count({ where }),
    prisma.voter.findMany({
      where: campaignScope,
      select: {
        precinctCode: true,
        gender: true,
        electionsVoted: true,
      },
    }),
  ]);

  return {
    campaign,
    voters: voters.map((voter) => ({
      id: voter.id,
      stateVoterId: voter.stateVoterId,
      name: [voter.firstName, voter.middleName, voter.lastName, voter.suffix]
        .filter(Boolean)
        .join(" "),
      yearOfBirth: voter.yearOfBirth,
      gender: voter.gender,
      address: `${voter.registrationAddress}, ${voter.city}, ${voter.state} ${voter.postalCode}`,
      precinct: voter.precinctCode,
      registrationDate: voter.registrationDate
        ? voter.registrationDate.toLocaleDateString("en-US")
        : null,
      electionsVoted: voter.electionsVoted,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    precincts: Array.from(
      new Set(optionRows.flatMap((row) => row.precinctCode ?? [])),
    ).sort(),
    genders: Array.from(
      new Set(optionRows.flatMap((row) => row.gender ?? [])),
    ).sort(),
    elections: Array.from(
      new Set(optionRows.flatMap((row) => row.electionsVoted)),
    ).sort()
      .reverse(),
  };
}
