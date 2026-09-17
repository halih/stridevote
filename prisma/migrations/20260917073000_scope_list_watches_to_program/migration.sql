ALTER TABLE "ListWatch" ADD COLUMN "programId" TEXT;

-- A list may be published into several waves. Preserve an old list-only watch
-- only when there is exactly one active wave it can unambiguously refer to.
UPDATE "ListWatch" AS watch
SET "programId" = active_program."programId"
FROM (
  SELECT link."listId", MIN(link."programId") AS "programId"
  FROM "ListCampaign" AS link
  JOIN "CanvassProgram" AS program ON program.id = link."programId"
  WHERE program.status = 'active'
  GROUP BY link."listId"
  HAVING COUNT(DISTINCT link."programId") = 1
) AS active_program
WHERE active_program."listId" = watch."listId";

DELETE FROM "ListWatch" WHERE "programId" IS NULL;

DROP INDEX "ListWatch_userId_listId_key";
ALTER TABLE "ListWatch" ALTER COLUMN "programId" SET NOT NULL;
ALTER TABLE "ListWatch"
  ADD CONSTRAINT "ListWatch_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "CanvassProgram"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ListWatch_userId_listId_programId_key"
  ON "ListWatch"("userId", "listId", "programId");
CREATE INDEX "ListWatch_listId_programId_idx"
  ON "ListWatch"("listId", "programId");
