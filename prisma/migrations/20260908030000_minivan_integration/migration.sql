-- MiniVAN campaign gate, enrichment fields, VanID on list voters, job queue.

ALTER TABLE "Campaign" ADD COLUMN "minivanEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Campaign" ADD COLUMN "minivanAdapterKey" TEXT;

ALTER TABLE "Voter" ADD COLUMN "phones" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Voter" ADD COLUMN "emails" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Voter" ADD COLUMN "likelyParty" TEXT;

ALTER TABLE "ListVoter" ADD COLUMN "vanId" INTEGER;
CREATE INDEX "ListVoter_listId_vanId_idx" ON "ListVoter"("listId", "vanId");

CREATE TABLE "MiniVanJob" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "campaignId" TEXT NOT NULL,
    "listId" TEXT,
    "requestedById" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "error" TEXT,
    "claimedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MiniVanJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MiniVanJob_status_createdAt_idx" ON "MiniVanJob"("status", "createdAt");
CREATE INDEX "MiniVanJob_campaignId_status_idx" ON "MiniVanJob"("campaignId", "status");
CREATE INDEX "MiniVanJob_listId_status_idx" ON "MiniVanJob"("listId", "status");

ALTER TABLE "MiniVanJob" ADD CONSTRAINT "MiniVanJob_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MiniVanJob" ADD CONSTRAINT "MiniVanJob_listId_fkey" FOREIGN KEY ("listId") REFERENCES "List"("id") ON DELETE SET NULL ON UPDATE CASCADE;
