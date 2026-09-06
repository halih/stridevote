-- Likely-voter flags now mean 50% or more participation, down from over 66%.
UPDATE "Voter"
SET
  "likelyPrimary" = COALESCE("primaryParticipation" >= 0.5, false),
  "likelyGeneral" = COALESCE("generalParticipation" >= 0.5, false);
