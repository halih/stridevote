-- Volunteer geographic list split: redirect stale offline packets and audit splits.

CREATE TABLE "ListHouseholdRedirect" (
    "id" TEXT NOT NULL,
    "fromListId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "toListId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListHouseholdRedirect_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ListHouseholdRedirect_fromListId_householdId_key"
  ON "ListHouseholdRedirect"("fromListId", "householdId");
CREATE INDEX "ListHouseholdRedirect_toListId_idx" ON "ListHouseholdRedirect"("toListId");
CREATE INDEX "ListHouseholdRedirect_householdId_idx" ON "ListHouseholdRedirect"("householdId");

ALTER TABLE "ListHouseholdRedirect"
  ADD CONSTRAINT "ListHouseholdRedirect_fromListId_fkey"
  FOREIGN KEY ("fromListId") REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ListHouseholdRedirect"
  ADD CONSTRAINT "ListHouseholdRedirect_toListId_fkey"
  FOREIGN KEY ("toListId") REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ListHouseholdRedirect"
  ADD CONSTRAINT "ListHouseholdRedirect_householdId_fkey"
  FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ListSplit" (
    "id" TEXT NOT NULL,
    "sourceListId" TEXT NOT NULL,
    "releasedListId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keptHalfKey" TEXT NOT NULL,
    "axis" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListSplit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ListSplit_sourceListId_idx" ON "ListSplit"("sourceListId");
CREATE INDEX "ListSplit_releasedListId_idx" ON "ListSplit"("releasedListId");
CREATE INDEX "ListSplit_programId_idx" ON "ListSplit"("programId");
CREATE INDEX "ListSplit_userId_idx" ON "ListSplit"("userId");

ALTER TABLE "ListSplit"
  ADD CONSTRAINT "ListSplit_sourceListId_fkey"
  FOREIGN KEY ("sourceListId") REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ListSplit"
  ADD CONSTRAINT "ListSplit_releasedListId_fkey"
  FOREIGN KEY ("releasedListId") REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ListSplit"
  ADD CONSTRAINT "ListSplit_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "CanvassProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ListSplit"
  ADD CONSTRAINT "ListSplit_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
