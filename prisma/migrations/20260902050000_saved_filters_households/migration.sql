-- CreateTable
CREATE TABLE "SavedVoterFilter" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "createdById" TEXT,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedVoterFilter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "displayAddress" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "unit" TEXT,
    "censusLat" DOUBLE PRECISION,
    "censusLng" DOUBLE PRECISION,
    "censusMatch" TEXT,
    "mapboxLat" DOUBLE PRECISION,
    "mapboxLng" DOUBLE PRECISION,
    "geocodeStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseholdVoter" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseholdVoter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListHousehold" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListHousehold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListVoter" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "matchedSeed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListVoter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SavedVoterFilter_campaignId_name_key" ON "SavedVoterFilter"("campaignId", "name");
CREATE INDEX "SavedVoterFilter_campaignId_idx" ON "SavedVoterFilter"("campaignId");

CREATE UNIQUE INDEX "Household_normalizedKey_key" ON "Household"("normalizedKey");
CREATE INDEX "Household_geocodeStatus_idx" ON "Household"("geocodeStatus");
CREATE INDEX "Household_censusLat_censusLng_idx" ON "Household"("censusLat", "censusLng");

CREATE UNIQUE INDEX "HouseholdVoter_voterId_key" ON "HouseholdVoter"("voterId");
CREATE INDEX "HouseholdVoter_householdId_idx" ON "HouseholdVoter"("householdId");

CREATE UNIQUE INDEX "ListHousehold_listId_householdId_key" ON "ListHousehold"("listId", "householdId");
CREATE INDEX "ListHousehold_listId_sortOrder_idx" ON "ListHousehold"("listId", "sortOrder");

CREATE UNIQUE INDEX "ListVoter_listId_voterId_key" ON "ListVoter"("listId", "voterId");
CREATE INDEX "ListVoter_listId_idx" ON "ListVoter"("listId");
CREATE INDEX "ListVoter_voterId_idx" ON "ListVoter"("voterId");

-- AddForeignKey
ALTER TABLE "SavedVoterFilter" ADD CONSTRAINT "SavedVoterFilter_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedVoterFilter" ADD CONSTRAINT "SavedVoterFilter_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "HouseholdVoter" ADD CONSTRAINT "HouseholdVoter_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HouseholdVoter" ADD CONSTRAINT "HouseholdVoter_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "Voter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ListHousehold" ADD CONSTRAINT "ListHousehold_listId_fkey" FOREIGN KEY ("listId") REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListHousehold" ADD CONSTRAINT "ListHousehold_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ListVoter" ADD CONSTRAINT "ListVoter_listId_fkey" FOREIGN KEY ("listId") REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListVoter" ADD CONSTRAINT "ListVoter_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "Voter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
