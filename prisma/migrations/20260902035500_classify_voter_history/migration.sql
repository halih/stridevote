ALTER TABLE "Voter"
  ADD COLUMN "primaryParticipation" DOUBLE PRECISION,
  ADD COLUMN "generalParticipation" DOUBLE PRECISION,
  ADD COLUMN "likelyPrimary" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "likelyGeneral" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "VoterHistory"
  ADD COLUMN "electionType" TEXT NOT NULL DEFAULT 'special';

UPDATE "VoterHistory"
SET "electionType" = CASE
  WHEN "electionDate" IN (
    DATE '1996-04-23', DATE '2008-02-19', DATE '2016-05-24',
    DATE '2020-03-10', DATE '2024-03-12'
  ) THEN 'presidential_primary'
  WHEN EXTRACT(MONTH FROM "electionDate") = 11 THEN 'general'
  WHEN (
    ("electionDate" >= DATE '2007-01-01' AND EXTRACT(MONTH FROM "electionDate") = 8)
    OR
    ("electionDate" < DATE '2007-01-01' AND EXTRACT(MONTH FROM "electionDate") = 9)
  ) THEN 'primary'
  ELSE 'special'
END;

CREATE INDEX "VoterHistory_electionType_electionDate_idx"
  ON "VoterHistory"("electionType", "electionDate");

-- Propensity uses complete biennial history only (2007–2024). A voter is
-- eligible for regular elections on or after their registration date.
WITH regular_dates AS (
  SELECT "electionType", "electionDate"
  FROM "VoterHistory"
  WHERE "electionType" IN ('primary', 'general')
    AND "electionDate" BETWEEN DATE '2007-01-01' AND DATE '2024-12-31'
  GROUP BY "electionType", "electionDate"
  HAVING COUNT(*) > 100
),
eligible AS (
  SELECT
    v.id,
    COUNT(*) FILTER (WHERE d."electionType" = 'primary')::int AS primary_eligible,
    COUNT(*) FILTER (WHERE d."electionType" = 'general')::int AS general_eligible
  FROM "Voter" v
  CROSS JOIN regular_dates d
  WHERE d."electionDate" >= COALESCE(v."registrationDate"::date, DATE '2007-01-01')
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
  WHERE h."electionDate" BETWEEN DATE '2007-01-01' AND DATE '2024-12-31'
    AND h."electionDate" >= COALESCE(v."registrationDate"::date, DATE '2007-01-01')
    AND h."electionType" IN ('primary', 'general')
  GROUP BY h."voterId"
)
UPDATE "Voter" v
SET
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
WHERE v.id = e.id;
