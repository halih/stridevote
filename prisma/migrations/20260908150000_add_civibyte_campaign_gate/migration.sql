-- CiviByte campaign gate.

ALTER TABLE "Campaign" ADD COLUMN "civibyteEnabled" BOOLEAN NOT NULL DEFAULT false;
