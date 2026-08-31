ALTER TABLE "ListCampaign"
ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'volunteers',
ADD COLUMN "assignedUserId" TEXT;

ALTER TABLE "ListCampaign"
ADD CONSTRAINT "ListCampaign_assignedUserId_fkey"
FOREIGN KEY ("assignedUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ListCampaign"
ADD CONSTRAINT "ListCampaign_visibility_check"
CHECK (
  "visibility" IN ('volunteers', 'assigned', 'draft')
  AND (
    ("visibility" = 'assigned' AND "assignedUserId" IS NOT NULL)
    OR ("visibility" <> 'assigned' AND "assignedUserId" IS NULL)
  )
);

CREATE INDEX "ListCampaign_campaignId_visibility_idx"
ON "ListCampaign"("campaignId", "visibility");

CREATE INDEX "ListCampaign_assignedUserId_idx"
ON "ListCampaign"("assignedUserId");
