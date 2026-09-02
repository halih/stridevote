CREATE TABLE "VoterHistory" (
  "id" TEXT NOT NULL,
  "sosHistoryId" TEXT,
  "stateVoterId" TEXT NOT NULL,
  "voterId" TEXT,
  "countyCode" TEXT,
  "countyCodeVoting" TEXT,
  "electionDate" DATE NOT NULL,
  "source" TEXT,

  CONSTRAINT "VoterHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VoterHistory_sosHistoryId_key" ON "VoterHistory"("sosHistoryId");
CREATE UNIQUE INDEX "VoterHistory_stateVoterId_electionDate_key" ON "VoterHistory"("stateVoterId", "electionDate");
CREATE INDEX "VoterHistory_voterId_idx" ON "VoterHistory"("voterId");
CREATE INDEX "VoterHistory_electionDate_idx" ON "VoterHistory"("electionDate");
CREATE INDEX "VoterHistory_stateVoterId_idx" ON "VoterHistory"("stateVoterId");

ALTER TABLE "VoterHistory"
ADD CONSTRAINT "VoterHistory_voterId_fkey"
FOREIGN KEY ("voterId") REFERENCES "Voter"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
