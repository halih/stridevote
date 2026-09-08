-- Archive walk lists instead of deleting canvass and volunteer history.
ALTER TABLE "List" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "List_deletedAt_idx" ON "List"("deletedAt");
