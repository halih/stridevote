ALTER TABLE "FieldEvent" ADD COLUMN "clientEventId" TEXT;

CREATE UNIQUE INDEX "FieldEvent_clientEventId_key" ON "FieldEvent"("clientEventId");
