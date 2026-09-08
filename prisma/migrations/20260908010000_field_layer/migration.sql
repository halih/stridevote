-- Master field layer: durable access, moved, and progressive scores across campaigns.

ALTER TABLE "CanvassAttempt" ADD COLUMN "observedScore" INTEGER;

ALTER TABLE "CanvassPersonResponse" ADD COLUMN "talkScore" INTEGER;

ALTER TABLE "Household"
  ADD COLUMN "accessStatus" TEXT NOT NULL DEFAULT 'ok',
  ADD COLUMN "observedScore" INTEGER,
  ADD COLUMN "observedScoreAt" TIMESTAMP(3),
  ADD COLUMN "accessUpdatedAt" TIMESTAMP(3);

CREATE INDEX "Household_accessStatus_idx" ON "Household"("accessStatus");
CREATE INDEX "Household_observedScore_idx" ON "Household"("observedScore");

ALTER TABLE "Voter"
  ADD COLUMN "residenceStatus" TEXT NOT NULL DEFAULT 'ok',
  ADD COLUMN "talkScore" INTEGER,
  ADD COLUMN "scoreUpdatedAt" TIMESTAMP(3);

CREATE INDEX "Voter_residenceStatus_idx" ON "Voter"("residenceStatus");
CREATE INDEX "Voter_talkScore_idx" ON "Voter"("talkScore");

CREATE TABLE "FieldEvent" (
    "id" TEXT NOT NULL,
    "householdId" TEXT,
    "voterId" TEXT,
    "kind" TEXT NOT NULL,
    "value" INTEGER,
    "campaignId" TEXT NOT NULL,
    "programId" TEXT,
    "attemptId" TEXT,
    "userId" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FieldEvent_householdId_kind_capturedAt_idx" ON "FieldEvent"("householdId", "kind", "capturedAt");
CREATE INDEX "FieldEvent_voterId_kind_capturedAt_idx" ON "FieldEvent"("voterId", "kind", "capturedAt");
CREATE INDEX "FieldEvent_campaignId_capturedAt_idx" ON "FieldEvent"("campaignId", "capturedAt");
CREATE INDEX "FieldEvent_attemptId_idx" ON "FieldEvent"("attemptId");

ALTER TABLE "FieldEvent" ADD CONSTRAINT "FieldEvent_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FieldEvent" ADD CONSTRAINT "FieldEvent_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "Voter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FieldEvent" ADD CONSTRAINT "FieldEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FieldEvent" ADD CONSTRAINT "FieldEvent_programId_fkey" FOREIGN KEY ("programId") REFERENCES "CanvassProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FieldEvent" ADD CONSTRAINT "FieldEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "CanvassAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FieldEvent" ADD CONSTRAINT "FieldEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
