-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "regionName" TEXT,
ADD COLUMN     "regionState" TEXT DEFAULT 'WA',
ADD COLUMN     "regionType" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "addressLine" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "locationSource" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "state" TEXT;
