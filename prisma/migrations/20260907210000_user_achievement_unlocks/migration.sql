-- CreateTable
CREATE TABLE "UserAchievementUnlock" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "campaignId" TEXT,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMP(3),

    CONSTRAINT "UserAchievementUnlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserAchievementUnlock_userId_seenAt_idx" ON "UserAchievementUnlock"("userId", "seenAt");

-- CreateIndex
CREATE INDEX "UserAchievementUnlock_campaignId_idx" ON "UserAchievementUnlock"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAchievementUnlock_userId_achievementId_scopeKey_key" ON "UserAchievementUnlock"("userId", "achievementId", "scopeKey");

-- AddForeignKey
ALTER TABLE "UserAchievementUnlock" ADD CONSTRAINT "UserAchievementUnlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievementUnlock" ADD CONSTRAINT "UserAchievementUnlock_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
