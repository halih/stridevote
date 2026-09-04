-- CreateTable
CREATE TABLE "Precinct" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'WA',
    "countyCode" TEXT NOT NULL,
    "countyName" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stateCode" TEXT,
    "boundary" JSONB NOT NULL,
    "geometry" JSONB NOT NULL,
    "centroidLat" DOUBLE PRECISION,
    "centroidLng" DOUBLE PRECISION,
    "minLat" DOUBLE PRECISION NOT NULL,
    "maxLat" DOUBLE PRECISION NOT NULL,
    "minLng" DOUBLE PRECISION NOT NULL,
    "maxLng" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Precinct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Precinct_state_countyCode_idx" ON "Precinct"("state", "countyCode");

-- CreateIndex
CREATE INDEX "Precinct_minLat_maxLat_idx" ON "Precinct"("minLat", "maxLat");

-- CreateIndex
CREATE INDEX "Precinct_minLng_maxLng_idx" ON "Precinct"("minLng", "maxLng");

-- CreateIndex
CREATE UNIQUE INDEX "Precinct_state_countyCode_code_key" ON "Precinct"("state", "countyCode", "code");
