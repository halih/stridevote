import "server-only";

import { prisma } from "@/lib/db";
import { can } from "@/lib/authz";
import { legislativeDistrictKey } from "@/lib/districts";
import type { ElectionType } from "@/lib/elections";
import type { User } from "@/generated/prisma";
import { getCampaignCanvassAudience } from "@/lib/canvass/progress";
import {
  DOOR_OUTCOME_LABELS,
  PERSON_OUTCOME_LABELS,
  type DoorOutcome,
  type PersonOutcome,
} from "@/lib/canvass/outcomes";
import {
  displayProgressiveScore,
  progressiveScoreLabel,
} from "@/lib/canvass/progressive-score";
import {
  buildVoterWhere,
  filtersToSearchParams,
  needsCanvassAudience,
  sanitizeVoterFilters,
  type CanvassAudienceIds,
  type PersistableVoterFilters,
  type VoterFilters,
} from "@/lib/voter-filters";

export type { VoterFilters, PersistableVoterFilters, CanvassAudienceIds };
export {
  filtersToSearchParams,
  sanitizeVoterFilters,
  filtersAreActive,
  searchParamsToFilters,
  buildVoterWhere,
  needsCanvassAudience,
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
  /** Latest door outcome across any wave. */
  canvassOutcome: string | null;
  canvassOutcomeKey: string | null;
  canvassProgramName: string | null;
}

export interface SavedVoterFilterRow {
  id: string;
  name: string;
  filters: PersistableVoterFilters;
  updatedAt: string;
}

/**
 * Set only when the campaign has no linked voters at all, so an empty directory
 * can tell "nothing imported for this district" apart from "imported already,
 * just not linked to this campaign".
 */
export interface RegionVoterSync {
  supported: boolean;
  district: string | null;
  available: number;
}

export interface CampaignVoterDirectory {
  campaign: { id: string; slug: string; name: string; district: string };
  voters: VoterDirectoryRow[];
  total: number;
  campaignTotal: number;
  regionSync: RegionVoterSync | null;
  filtered: boolean;
  page: number;
  pageSize: number;
  precincts: Array<{ value: string; label: string }>;
  genders: string[];
  elections: Array<{ date: string; type: ElectionType }>;
  savedFilters: SavedVoterFilterRow[];
}

const PAGE_SIZE = 50;

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Resolve canvass door audience for voter filters (any wave in the campaign). */
export async function resolveCanvassAudience(
  campaignId: string,
  filters: VoterFilters,
): Promise<CanvassAudienceIds | null> {
  if (!needsCanvassAudience(filters)) return null;
  const audience = await getCampaignCanvassAudience(campaignId);
  return {
    canvassedHouseholdIds: audience.canvassedHouseholdIds,
    inaccessibleHouseholdIds: audience.inaccessibleHouseholdIds,
    unsafeHouseholdIds: audience.unsafeHouseholdIds,
  };
}

/** How many voters the campaign's district could contribute, if any. */
async function regionVoterSync(campaign: {
  regionType: string | null;
  regionName: string | null;
}): Promise<RegionVoterSync> {
  const district =
    campaign.regionType === "legislative"
      ? legislativeDistrictKey(campaign.regionName)
      : null;
  if (!district) return { supported: false, district: null, available: 0 };

  const available = await prisma.voter.count({
    where: {
      OR: [
        { legislativeDistrict: district },
        { legislativeDistrict: district.padStart(2, "0") },
        { legislativeDistrict: district.padStart(3, "0") },
      ],
    },
  });
  return { supported: true, district, available };
}

export async function getCampaignVoterDirectory(
  slug: string,
  user: User,
  filters: VoterFilters,
): Promise<CampaignVoterDirectory | null> {
  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      district: true,
      regionType: true,
      regionName: true,
    },
  });
  if (!campaign || !(await can(user, campaign.id, "voters:view"))) return null;

  const campaignAudience = await getCampaignCanvassAudience(campaign.id);
  const canvass: CanvassAudienceIds = {
    canvassedHouseholdIds: campaignAudience.canvassedHouseholdIds,
    inaccessibleHouseholdIds: campaignAudience.inaccessibleHouseholdIds,
    unsafeHouseholdIds: campaignAudience.unsafeHouseholdIds,
  };

  const { where, filtered, page } = buildVoterWhere(
    campaign.id,
    filters,
    new Date(),
    canvass,
  );
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
          householdLinks: {
            take: 1,
            select: { householdId: true },
          },
        },
      }),
      prisma.voter.count({ where }),
      filtered ? prisma.voter.count({ where: campaignScope }) : Promise.resolve(0),
      prisma.$queryRaw<Array<{
        countyCode: string;
        precinctCode: string;
        precinctName: string | null;
      }>>`
        SELECT DISTINCT
          v."countyCode",
          v."precinctCode",
          p."name" AS "precinctName"
        FROM "Voter" v
        INNER JOIN "CampaignVoter" cv ON cv."voterId" = v.id
        LEFT JOIN "Precinct" p
          ON p."state" = v."state"
          AND p."countyCode" = v."countyCode"
          AND p."code" = v."precinctCode"
        WHERE cv."campaignId" = ${campaign.id}
          AND v."precinctCode" IS NOT NULL
          AND v."countyCode" IS NOT NULL
        ORDER BY "precinctName" NULLS LAST, v."precinctCode"
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

  // Unfiltered, `total` is the campaign's whole linked set.
  const regionSync = !filtered && total === 0 ? await regionVoterSync(campaign) : null;

  return {
    campaign: {
      id: campaign.id,
      slug: campaign.slug,
      name: campaign.name,
      district: campaign.district,
    },
    regionSync,
    voters: voters.map((voter) => {
      const householdId = voter.householdLinks[0]?.householdId ?? null;
      const latest = householdId
        ? campaignAudience.latestByHousehold.get(householdId) ?? null
        : null;
      return {
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
        canvassOutcomeKey: latest?.outcome ?? null,
        canvassOutcome: latest
          ? DOOR_OUTCOME_LABELS[latest.outcome as DoorOutcome] ?? latest.outcome
          : null,
        canvassProgramName: latest?.programName ?? null,
      };
    }),
    total,
    campaignTotal: filtered ? campaignTotal : total,
    filtered,
    page,
    pageSize: PAGE_SIZE,
    precincts: precincts.map((row) => ({
      value: `${row.countyCode}:${row.precinctCode}`,
      label: row.precinctName ?? row.precinctCode,
    })),
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
    residenceStatus: string;
    talkScore: number | null;
    scoreUpdatedAt: string | null;
    scoreSource: string | null;
    phones: string[];
    emails: string[];
  };
  household: {
    id: string;
    accessStatus: string;
    observedScore: number | null;
    observedScoreAt: string | null;
    accessUpdatedAt: string | null;
  } | null;
  displayScore: {
    score: number | null;
    source: "talk" | "import" | "observed" | null;
    label: string;
  };
  fieldEvents: Array<{
    id: string;
    kind: string;
    value: number | null;
    capturedAt: string;
    campaignName: string;
    canvasser: string | null;
  }>;
  history: Array<{
    id: string;
    electionDate: string;
    electionType: ElectionType;
  }>;
  canvassHistory: Array<{
    id: string;
    programName: string;
    listName: string;
    outcome: string;
    outcomeLabel: string;
    capturedAt: string;
    canvasser: string;
    superseded: boolean;
    personOutcome: string | null;
    personOutcomeLabel: string | null;
    support: number | null;
    talkScore: number | null;
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
      householdLinks: {
        take: 1,
        select: {
          householdId: true,
          household: {
            select: {
              id: true,
              accessStatus: true,
              observedScore: true,
              observedScoreAt: true,
              accessUpdatedAt: true,
            },
          },
        },
      },
    },
  });
  if (!voter) return null;

  const household = voter.householdLinks[0]?.household ?? null;
  const householdId = household?.id ?? null;
  const attempts = householdId
    ? await prisma.canvassAttempt.findMany({
        where: {
          householdId,
          campaignId: campaign.id,
        },
        orderBy: { capturedAt: "desc" },
        select: {
          id: true,
          clientAttemptId: true,
          supersedesClientId: true,
          outcome: true,
          capturedAt: true,
          program: { select: { name: true } },
          list: { select: { name: true } },
          user: { select: { name: true, email: true, phone: true } },
          people: {
            where: { voterId },
            select: { outcome: true, support: true, talkScore: true },
            take: 1,
          },
        },
      })
    : [];

  const fieldEvents = await prisma.fieldEvent.findMany({
    where: {
      OR: [
        { voterId },
        ...(householdId ? [{ householdId }] : []),
      ],
    },
    orderBy: { capturedAt: "desc" },
    take: 40,
    select: {
      id: true,
      kind: true,
      value: true,
      capturedAt: true,
      campaign: { select: { name: true } },
      user: { select: { name: true, email: true, phone: true } },
    },
  });

  const superseded = new Set(
    attempts
      .map((a) => a.supersedesClientId)
      .filter((id): id is string => Boolean(id)),
  );

  const display = displayProgressiveScore({
    talkScore: voter.talkScore,
    scoreUpdatedAt: voter.scoreUpdatedAt,
    scoreSource: voter.scoreSource,
    observedScore: household?.observedScore,
    observedScoreAt: household?.observedScoreAt,
  });

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
      residenceStatus: voter.residenceStatus,
      talkScore: voter.talkScore,
      scoreUpdatedAt: voter.scoreUpdatedAt?.toISOString() ?? null,
      scoreSource: voter.scoreSource,
      phones: voter.phones ?? [],
      emails: voter.emails ?? [],
    },
    household: household
      ? {
          id: household.id,
          accessStatus: household.accessStatus,
          observedScore: household.observedScore,
          observedScoreAt: household.observedScoreAt?.toISOString() ?? null,
          accessUpdatedAt: household.accessUpdatedAt?.toISOString() ?? null,
        }
      : null,
    displayScore: {
      score: display.score,
      source: display.source,
      label: progressiveScoreLabel(display.score),
    },
    fieldEvents: fieldEvents.map((e) => ({
      id: e.id,
      kind: e.kind,
      value: e.value,
      capturedAt: e.capturedAt.toISOString(),
      campaignName: e.campaign.name,
      canvasser: e.user?.name ?? e.user?.email ?? e.user?.phone ?? null,
    })),
    history: voter.history.map((row) => ({
      id: row.id,
      electionDate: isoDate(row.electionDate),
      electionType: row.electionType as ElectionType,
    })),
    canvassHistory: attempts.map((a) => {
      const person = a.people[0] ?? null;
      return {
        id: a.id,
        programName: a.program.name,
        listName: a.list.name,
        outcome: a.outcome,
        outcomeLabel:
          DOOR_OUTCOME_LABELS[a.outcome as DoorOutcome] ?? a.outcome,
        capturedAt: a.capturedAt.toISOString(),
        canvasser: a.user.name ?? a.user.email ?? a.user.phone ?? "Volunteer",
        superseded: superseded.has(a.clientAttemptId),
        personOutcome: person?.outcome ?? null,
        personOutcomeLabel: person
          ? PERSON_OUTCOME_LABELS[person.outcome as PersonOutcome] ??
            person.outcome
          : null,
        support: person?.support ?? null,
        talkScore: person?.talkScore ?? null,
      };
    }),
  };
}
