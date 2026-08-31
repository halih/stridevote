ALTER TABLE "ListCampaign"
DROP CONSTRAINT "ListCampaign_visibility_check";

ALTER TABLE "ListCampaign"
ADD CONSTRAINT "ListCampaign_visibility_check"
CHECK ("visibility" IN ('volunteers', 'assigned', 'draft'));
