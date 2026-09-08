-- Prefer archiving campaigns while retaining a deliberate permanent-delete path.
ALTER TABLE "Campaign" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE INDEX "Campaign_archivedAt_idx" ON "Campaign"("archivedAt");

-- Master field write-back must remain reproducible after its source campaign
-- is permanently deleted. Keep an immutable campaign key on each event.
ALTER TABLE "FieldEvent" ADD COLUMN "sourceCampaignId" TEXT;
UPDATE "FieldEvent" SET "sourceCampaignId" = "campaignId";
ALTER TABLE "FieldEvent" ALTER COLUMN "sourceCampaignId" SET NOT NULL;

ALTER TABLE "FieldEvent" ALTER COLUMN "campaignId" DROP NOT NULL;
ALTER TABLE "FieldEvent" DROP CONSTRAINT "FieldEvent_campaignId_fkey";
ALTER TABLE "FieldEvent"
  ADD CONSTRAINT "FieldEvent_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "FieldEvent_sourceCampaignId_capturedAt_idx"
  ON "FieldEvent"("sourceCampaignId", "capturedAt");
