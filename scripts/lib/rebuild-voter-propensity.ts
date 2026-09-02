import type { PrismaClient } from "../../src/generated/prisma";

/**
 * Scores each voter against the regular primaries/generals held since they
 * registered.
 *
 * Only elections we have a full ballot list for are counted. A biennial SOS
 * history file gives every ballot for its elections; the VRDB `LastVoted`
 * column only gives each voter's most recent ballot, so it is complete for the
 * newest election and partial for anything older that the history files have
 * not caught up to yet.
 */
export async function rebuildVoterPropensity(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    WITH latest AS (
      SELECT MAX("electionDate") AS "electionDate" FROM "VoterHistory"
    ),
    complete_elections AS (
      SELECT h."electionType", h."electionDate"
      FROM "VoterHistory" h
      WHERE h."electionType" IN ('primary', 'general')
        AND h."electionDate" >= DATE '2007-01-01'
      GROUP BY h."electionType", h."electionDate"
      HAVING COUNT(*) FILTER (
               WHERE h.source IS DISTINCT FROM 'VRDB LastVoted'
             ) > 100
         OR h."electionDate" = (SELECT "electionDate" FROM latest)
    ),
    eligible AS (
      SELECT
        v.id,
        COUNT(*) FILTER (
          WHERE d."electionType" = 'primary'
            AND d."electionDate" >= COALESCE(v."registrationDate"::date, DATE '2007-01-01')
        )::int AS primary_eligible,
        COUNT(*) FILTER (
          WHERE d."electionType" = 'general'
            AND d."electionDate" >= COALESCE(v."registrationDate"::date, DATE '2007-01-01')
        )::int AS general_eligible
      FROM "Voter" v
      CROSS JOIN complete_elections d
      GROUP BY v.id
    ),
    voted AS (
      SELECT
        h."voterId" AS id,
        COUNT(DISTINCT h."electionDate") FILTER (
          WHERE h."electionType" = 'primary'
        )::int AS primary_voted,
        COUNT(DISTINCT h."electionDate") FILTER (
          WHERE h."electionType" = 'general'
        )::int AS general_voted
      FROM "VoterHistory" h
      INNER JOIN "Voter" v ON v.id = h."voterId"
      INNER JOIN complete_elections d
        ON d."electionType" = h."electionType"
       AND d."electionDate" = h."electionDate"
      WHERE h."electionDate" >= COALESCE(v."registrationDate"::date, DATE '2007-01-01')
      GROUP BY h."voterId"
    )
    UPDATE "Voter" v
    SET
      "primaryEligible" = e.primary_eligible,
      "primaryVoted" = COALESCE(x.primary_voted, 0),
      "generalEligible" = e.general_eligible,
      "generalVoted" = COALESCE(x.general_voted, 0),
      "primaryParticipation" = CASE
        WHEN e.primary_eligible > 0
        THEN COALESCE(x.primary_voted, 0)::float / e.primary_eligible
      END,
      "generalParticipation" = CASE
        WHEN e.general_eligible > 0
        THEN COALESCE(x.general_voted, 0)::float / e.general_eligible
      END,
      "likelyPrimary" = e.primary_eligible > 0
        AND COALESCE(x.primary_voted, 0)::float / e.primary_eligible > 0.66,
      "likelyGeneral" = e.general_eligible > 0
        AND COALESCE(x.general_voted, 0)::float / e.general_eligible > 0.66
    FROM eligible e
    LEFT JOIN voted x ON x.id = e.id
    WHERE v.id = e.id
  `);
}
