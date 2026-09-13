ALTER TABLE "CanvassProgram"
ADD COLUMN "electionType" TEXT NOT NULL DEFAULT 'general',
ADD COLUMN "electionDate" DATE;

UPDATE "CanvassProgram"
SET "electionType" = 'primary'
WHERE LOWER("name") LIKE '%primary%';
