CREATE TABLE "Voter" (
  "id" TEXT NOT NULL,
  "stateVoterId" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "middleName" TEXT,
  "lastName" TEXT NOT NULL,
  "suffix" TEXT,
  "yearOfBirth" INTEGER,
  "gender" TEXT,
  "registrationAddress" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "postalCode" TEXT NOT NULL,
  "countyCode" TEXT,
  "precinctCode" TEXT,
  "precinctPart" TEXT,
  "legislativeDistrict" TEXT,
  "congressionalDistrict" TEXT,
  "registrationDate" TIMESTAMP(3),
  "electionsVoted" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "lat" DOUBLE PRECISION,
  "lng" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Voter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CampaignVoter" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "voterId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignVoter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Voter_stateVoterId_key" ON "Voter"("stateVoterId");
CREATE INDEX "Voter_lastName_firstName_idx" ON "Voter"("lastName", "firstName");
CREATE INDEX "Voter_precinctCode_idx" ON "Voter"("precinctCode");
CREATE INDEX "Voter_legislativeDistrict_idx" ON "Voter"("legislativeDistrict");
CREATE INDEX "Voter_congressionalDistrict_idx" ON "Voter"("congressionalDistrict");
CREATE UNIQUE INDEX "CampaignVoter_campaignId_voterId_key" ON "CampaignVoter"("campaignId", "voterId");
CREATE INDEX "CampaignVoter_campaignId_idx" ON "CampaignVoter"("campaignId");

ALTER TABLE "CampaignVoter"
ADD CONSTRAINT "CampaignVoter_campaignId_fkey"
FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CampaignVoter"
ADD CONSTRAINT "CampaignVoter_voterId_fkey"
FOREIGN KEY ("voterId") REFERENCES "Voter"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
