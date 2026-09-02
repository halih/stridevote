import "server-only";

import { prisma } from "@/lib/db";
import { can } from "@/lib/authz";
import type { ElectionType } from "@/lib/elections";
import type { User } from "@/generated/prisma";
import {
  buildVoterWhere,
  filtersToSearchParams,
  sanitizeVoterFilters,
  type PersistableVoterFilters,
  type VoterFilters,
} from "@/lib/voter-filters";

export type { VoterFilters, PersistableVoterFilters };
export {
  filtersToSearchParams,
  sanitizeVoterFilters,
  filtersAreActive,
  searchParamsToFilters,
  buildVoterWhere,
} from "@/lib/voter-filters";

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
  electionCount: number;
  lastElection: string | null;
  primaryParticipation: number | null;
  generalParticipation: number | null;
}

export interface SavedVoterFilterRow {
  id: string;
  name: string;
  filters: PersistableVoterFilters;
  updatedAt: string;
}

export interface CampaignVoterDirectory {
  campaign: { id: string; slug: string; name: string; district: string };
  voters: VoterDirectoryRow[];
  total: number;
  campaignTotal: number;
  filtered: boolean;
  page: number;
  pageSize: number;
  precincts: string[];
  genders: string[];
  elections: Array<{ date: string; type: ElectionType }>;
  savedFilters: SavedVoterFilterRow[];
}

const PAGE_SIZE = 50;

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
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

  const { where, filtered, page } = buildVoterWhere(campaign.id, filters);
  const campaignScope = { campaignLinks: { some: { campaignId: campaign.id } } };

  const [voters, total, campaignTotal, precincts, genders, elections, savedFilters] =
    await Promise.all([
      prisma.voter.findMany({
        where,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          _count: { select: { history: true } },
          history: {
            orderBy: { electionDate: "desc" },
            take: 1,
            select: { electionDate: true },
          },
        },
      }),
      prisma.voter.count({ where }),
      filtered ? prisma.voter.count({ where: campaignScope }) : Promise.resolve(0),
      prisma.$queryRaw<Array<{ precinctCode: string }>>`
        SELECT DISTINCT v."precinctCode"
        FROM "Voter" v
        INNER JOIN "CampaignVoter" cv ON cv."voterId" = v.id
        WHERE cv."campaignId" = ${campaign.id}
          AND v."precinctCode" IS NOT NULL
        ORDER BY 1
      `,
      prisma.$queryRaw<Array<{ gender: string }>>`
        SELECT DISTINCT v.gender
        FROM "Voter" v
        INNER JOIN "CampaignVoter" cv ON cv."voterId" = v.id
        WHERE cv."campaignId" = ${campaign.id}
          AND v.gender IS NOT NULL
        ORDER BY 1
      `,
      prisma.$queryRaw<Array<{ election: Date; electionType: ElectionType }>>`
        SELECT DISTINCT
          h."electionDate" AS election,
          h."electionType" AS "electionType"
        FROM "VoterHistory" h
        INNER JOIN "CampaignVoter" cv ON cv."voterId" = h."voterId"
        WHERE cv."campaignId" = ${campaign.id}
          AND h."voterId" IS NOT NULL
        ORDER BY 1 DESC
      `,
      prisma.savedVoterFilter.findMany({
        where: { campaignId: campaign.id },
        orderBy: { name: "asc" },
        select: { id: true, name: true, filters: true, updatedAt: true },
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
      electionCount: voter._count.history,
      lastElection: voter.history[0] ? isoDate(voter.history[0].electionDate) : null,
      primaryParticipation: voter.primaryParticipation,
      generalParticipation: voter.generalParticipation,
    })),
    total,
    campaignTotal: filtered ? campaignTotal : total,
    filtered,
    page,
    pageSize: PAGE_SIZE,
    precincts: precincts.map((row) => row.precinctCode),
    genders: genders.map((row) => row.gender),
    elections: elections.map((row) => ({
      date: isoDate(row.election),
      type: row.electionType,
    })),
    savedFilters: savedFilters.map((row) => ({
      id: row.id,
      name: row.name,
      filters: sanitizeVoterFilters(row.filters),
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}

export interface VoterHistoryDetail {
  campaign: { slug: string; name: string; district: string };
  voter: {
    id: string;
    stateVoterId: string;
    name: string;
    address: string;
    yearOfBirth: number | null;
    gender: string | null;
    precinct: string | null;
    registrationDate: string | null;
    primaryParticipation: number | null;
    generalParticipation: number | null;
    primaryEligible: number | null;
    primaryVoted: number | null;
    generalEligible: number | null;
    generalVoted: number | null;
    likelyPrimary: boolean;
    likelyGeneral: boolean;
  };
  history: Array<{
    id: string;
    electionDate: string;
    electionType: ElectionType;
  }>;
}

export async function getVoterHistoryDetail(
  slug: string,
  voterId: string,
  user: User,
): Promise<VoterHistoryDetail | null> {
  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, district: true },
  });
  if (!campaign || !(await can(user, campaign.id, "voters:view"))) return null;

  const voter = await prisma.voter.findFirst({
    where: {
      id: voterId,
      campaignLinks: { some: { campaignId: campaign.id } },
    },
    include: {
      history: {
        orderBy: { electionDate: "desc" },
        select: { id: true, electionDate: true, electionType: true },
      },
    },
  });
  if (!voter) return null;

  return {
    campaign,
    voter: {
      id: voter.id,
      stateVoterId: voter.stateVoterId,
      name: [voter.firstName, voter.middleName, voter.lastName, voter.suffix]
        .filter(Boolean)
        .join(" "),
      address: `${voter.registrationAddress}, ${voter.city}, ${voter.state} ${voter.postalCode}`,
      yearOfBirth: voter.yearOfBirth,
      gender: voter.gender,
      precinct: voter.precinctCode,
      registrationDate: voter.registrationDate
        ? isoDate(voter.registrationDate)
        : null,
      primaryParticipation: voter.primaryParticipation,
      generalParticipation: voter.generalParticipation,
      primaryEligible: voter.primaryEligible,
      primaryVoted: voter.primaryVoted,
      generalEligible: voter.generalEligible,
      generalVoted: voter.generalVoted,
      likelyPrimary: voter.likelyPrimary,
      likelyGeneral: voter.likelyGeneral,
    },
    history: voter.history.map((row) => ({
      id: row.id,
      electionDate: isoDate(row.electionDate),
      electionType: row.electionType as ElectionType,
    })),
  };
}

export async function listSavedVoterFilters(campaignId: string) {
  return prisma.savedVoterFilter.findMany({
    where: { campaignId },
    orderBy: { name: "asc" },
  });
}
