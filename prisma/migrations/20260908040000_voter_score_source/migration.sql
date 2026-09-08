-- Distinguish MiniVAN-seeded progressive scores from real conversation scores.
ALTER TABLE "Voter" ADD COLUMN "scoreSource" TEXT;
