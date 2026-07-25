-- AlterTable
ALTER TABLE "CampaignMembership" ADD COLUMN     "roles" TEXT[] DEFAULT ARRAY['canvasser']::TEXT[];

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;
