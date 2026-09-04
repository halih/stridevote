-- Named canvass programs, program-scoped list publish/checkout, walk snapshots,
-- and append-only canvass attempts.

CREATE TABLE "CanvassProgram" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "script" TEXT,
    "questions" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanvassProgram_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CanvassProgram_campaignId_name_key" ON "CanvassProgram"("campaignId", "name");
CREATE INDEX "CanvassProgram_campaignId_status_idx" ON "CanvassProgram"("campaignId", "status");

ALTER TABLE "CanvassProgram"
  ADD CONSTRAINT "CanvassProgram_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One default active program per existing campaign.
INSERT INTO "CanvassProgram" ("id", "campaignId", "name", "status", "questions", "updatedAt")
SELECT
  'prog_' || "id",
  "id",
  'Default',
  'active',
  '[]'::jsonb,
  CURRENT_TIMESTAMP
FROM "Campaign";

-- Scope ListCampaign to a program.
ALTER TABLE "ListCampaign" ADD COLUMN "programId" TEXT;

UPDATE "ListCampaign" lc
SET "programId" = p."id"
FROM "CanvassProgram" p
WHERE p."campaignId" = lc."campaignId" AND p."name" = 'Default';

ALTER TABLE "ListCampaign" ALTER COLUMN "programId" SET NOT NULL;

DROP INDEX IF EXISTS "ListCampaign_listId_campaignId_key";
CREATE UNIQUE INDEX "ListCampaign_listId_campaignId_programId_key"
  ON "ListCampaign"("listId", "campaignId", "programId");
CREATE INDEX "ListCampaign_programId_visibility_idx" ON "ListCampaign"("programId", "visibility");

ALTER TABLE "ListCampaign"
  ADD CONSTRAINT "ListCampaign_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "CanvassProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Scope ListCheckout to a program.
ALTER TABLE "ListCheckout" ADD COLUMN "programId" TEXT;

UPDATE "ListCheckout" co
SET "programId" = lc."programId"
FROM "ListCampaign" lc
WHERE lc."listId" = co."listId";

-- Orphan checkouts (list with no campaign link): attach to any Default program via first campaign link, or delete.
-- If still null, pick an arbitrary program from a campaign that links the list; otherwise leave for NOT NULL fail.
UPDATE "ListCheckout" co
SET "programId" = sub."programId"
FROM (
  SELECT DISTINCT ON (lc."listId") lc."listId", lc."programId"
  FROM "ListCampaign" lc
  ORDER BY lc."listId", lc."id"
) sub
WHERE co."listId" = sub."listId" AND co."programId" IS NULL;

DELETE FROM "ListCheckout" WHERE "programId" IS NULL;

ALTER TABLE "ListCheckout" ALTER COLUMN "programId" SET NOT NULL;

DROP INDEX IF EXISTS "ListCheckout_listId_status_idx";
CREATE INDEX "ListCheckout_listId_programId_status_idx"
  ON "ListCheckout"("listId", "programId", "status");
CREATE INDEX "ListCheckout_programId_status_idx" ON "ListCheckout"("programId", "status");

ALTER TABLE "ListCheckout"
  ADD CONSTRAINT "ListCheckout_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "CanvassProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Walk snapshots for published program lists.
CREATE TABLE "ProgramListHousehold" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramListHousehold_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProgramListHousehold_programId_listId_householdId_key"
  ON "ProgramListHousehold"("programId", "listId", "householdId");
CREATE INDEX "ProgramListHousehold_programId_listId_sortOrder_idx"
  ON "ProgramListHousehold"("programId", "listId", "sortOrder");

ALTER TABLE "ProgramListHousehold"
  ADD CONSTRAINT "ProgramListHousehold_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "CanvassProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgramListHousehold"
  ADD CONSTRAINT "ProgramListHousehold_listId_fkey"
  FOREIGN KEY ("listId") REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgramListHousehold"
  ADD CONSTRAINT "ProgramListHousehold_householdId_fkey"
  FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProgramListVoter" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "matchedSeed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramListVoter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProgramListVoter_programId_listId_voterId_key"
  ON "ProgramListVoter"("programId", "listId", "voterId");
CREATE INDEX "ProgramListVoter_programId_listId_idx"
  ON "ProgramListVoter"("programId", "listId");

ALTER TABLE "ProgramListVoter"
  ADD CONSTRAINT "ProgramListVoter_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "CanvassProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgramListVoter"
  ADD CONSTRAINT "ProgramListVoter_listId_fkey"
  FOREIGN KEY ("listId") REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgramListVoter"
  ADD CONSTRAINT "ProgramListVoter_voterId_fkey"
  FOREIGN KEY ("voterId") REFERENCES "Voter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Snapshot existing non-draft list↔households into their program.
INSERT INTO "ProgramListHousehold" ("id", "programId", "listId", "householdId", "sortOrder", "createdAt")
SELECT
  'plh_' || lh."id",
  lc."programId",
  lh."listId",
  lh."householdId",
  lh."sortOrder",
  CURRENT_TIMESTAMP
FROM "ListHousehold" lh
JOIN "ListCampaign" lc ON lc."listId" = lh."listId"
WHERE lc."visibility" <> 'draft'
ON CONFLICT DO NOTHING;

INSERT INTO "ProgramListVoter" ("id", "programId", "listId", "voterId", "matchedSeed", "createdAt")
SELECT
  'plv_' || lv."id",
  lc."programId",
  lv."listId",
  lv."voterId",
  lv."matchedSeed",
  CURRENT_TIMESTAMP
FROM "ListVoter" lv
JOIN "ListCampaign" lc ON lc."listId" = lv."listId"
WHERE lc."visibility" <> 'draft'
ON CONFLICT DO NOTHING;

-- Append-only attempts.
CREATE TABLE "CanvassAttempt" (
    "id" TEXT NOT NULL,
    "clientAttemptId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "checkoutId" TEXT,
    "userId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "notes" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "supersedesClientId" TEXT,
    "staleCheckout" BOOLEAN NOT NULL DEFAULT false,
    "packetVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanvassAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CanvassAttempt_clientAttemptId_key" ON "CanvassAttempt"("clientAttemptId");
CREATE INDEX "CanvassAttempt_programId_listId_householdId_capturedAt_idx"
  ON "CanvassAttempt"("programId", "listId", "householdId", "capturedAt");
CREATE INDEX "CanvassAttempt_campaignId_programId_capturedAt_idx"
  ON "CanvassAttempt"("campaignId", "programId", "capturedAt");
CREATE INDEX "CanvassAttempt_userId_capturedAt_idx" ON "CanvassAttempt"("userId", "capturedAt");
CREATE INDEX "CanvassAttempt_checkoutId_idx" ON "CanvassAttempt"("checkoutId");
CREATE INDEX "CanvassAttempt_staleCheckout_idx" ON "CanvassAttempt"("staleCheckout");
CREATE INDEX "CanvassAttempt_supersedesClientId_idx" ON "CanvassAttempt"("supersedesClientId");

ALTER TABLE "CanvassAttempt"
  ADD CONSTRAINT "CanvassAttempt_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "CanvassProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanvassAttempt"
  ADD CONSTRAINT "CanvassAttempt_listId_fkey"
  FOREIGN KEY ("listId") REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanvassAttempt"
  ADD CONSTRAINT "CanvassAttempt_householdId_fkey"
  FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanvassAttempt"
  ADD CONSTRAINT "CanvassAttempt_checkoutId_fkey"
  FOREIGN KEY ("checkoutId") REFERENCES "ListCheckout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CanvassAttempt"
  ADD CONSTRAINT "CanvassAttempt_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanvassAttempt"
  ADD CONSTRAINT "CanvassAttempt_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CanvassPersonResponse" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "support" INTEGER,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,

    CONSTRAINT "CanvassPersonResponse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CanvassPersonResponse_attemptId_voterId_key"
  ON "CanvassPersonResponse"("attemptId", "voterId");
CREATE INDEX "CanvassPersonResponse_voterId_idx" ON "CanvassPersonResponse"("voterId");

ALTER TABLE "CanvassPersonResponse"
  ADD CONSTRAINT "CanvassPersonResponse_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "CanvassAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanvassPersonResponse"
  ADD CONSTRAINT "CanvassPersonResponse_voterId_fkey"
  FOREIGN KEY ("voterId") REFERENCES "Voter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
