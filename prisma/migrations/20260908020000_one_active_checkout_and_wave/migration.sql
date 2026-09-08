-- Collapse duplicate active checkouts (keep the oldest), then enforce one hold per list+wave.
UPDATE "ListCheckout" AS loser
SET status = 'released', "releasedAt" = CURRENT_TIMESTAMP
WHERE status = 'active'
AND EXISTS (
  SELECT 1 FROM "ListCheckout" AS keeper
  WHERE keeper.status = 'active'
    AND keeper."listId" = loser."listId"
    AND keeper."programId" = loser."programId"
    AND (
      keeper."checkedOutAt" < loser."checkedOutAt"
      OR (keeper."checkedOutAt" = loser."checkedOutAt" AND keeper.id < loser.id)
    )
);

CREATE UNIQUE INDEX "ListCheckout_listId_programId_active_key"
  ON "ListCheckout"("listId", "programId")
  WHERE status = 'active';
