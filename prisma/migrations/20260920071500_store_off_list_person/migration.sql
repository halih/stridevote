ALTER TABLE "CanvassAttempt"
DROP COLUMN "offListContact";

ALTER TABLE "CanvassPersonResponse"
ALTER COLUMN "voterId" DROP NOT NULL,
ADD COLUMN "offList" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "CanvassPersonResponse"
ADD CONSTRAINT "CanvassPersonResponse_person_identity_check"
CHECK (
  ("offList" = true AND "voterId" IS NULL)
  OR
  ("offList" = false AND "voterId" IS NOT NULL)
);
