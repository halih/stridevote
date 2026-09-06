-- Collapse Census/Mapbox coordinate pairs into one lat/lng + source.
-- Prefer existing Mapbox pins (legacy persist) over Census interpolations.

ALTER TABLE "Household" ADD COLUMN "lat" DOUBLE PRECISION;
ALTER TABLE "Household" ADD COLUMN "lng" DOUBLE PRECISION;
ALTER TABLE "Household" ADD COLUMN "geocodeSource" TEXT;
ALTER TABLE "Household" ADD COLUMN "geocodeRef" TEXT;

UPDATE "Household"
SET
  "lat" = CASE
    WHEN "mapboxLat" IS NOT NULL AND "mapboxLng" IS NOT NULL THEN "mapboxLat"
    ELSE "censusLat"
  END,
  "lng" = CASE
    WHEN "mapboxLat" IS NOT NULL AND "mapboxLng" IS NOT NULL THEN "mapboxLng"
    ELSE "censusLng"
  END,
  "geocodeSource" = CASE
    WHEN "mapboxLat" IS NOT NULL AND "mapboxLng" IS NOT NULL THEN 'mapbox'
    WHEN "censusLat" IS NOT NULL AND "censusLng" IS NOT NULL THEN 'census'
    ELSE NULL
  END
WHERE
  ("mapboxLat" IS NOT NULL AND "mapboxLng" IS NOT NULL)
  OR ("censusLat" IS NOT NULL AND "censusLng" IS NOT NULL);

DROP INDEX IF EXISTS "Household_censusLat_censusLng_idx";

ALTER TABLE "Household" DROP COLUMN "censusLat";
ALTER TABLE "Household" DROP COLUMN "censusLng";
ALTER TABLE "Household" DROP COLUMN "mapboxLat";
ALTER TABLE "Household" DROP COLUMN "mapboxLng";

CREATE INDEX "Household_lat_lng_idx" ON "Household"("lat", "lng");
CREATE INDEX "Household_geocodeSource_idx" ON "Household"("geocodeSource");
