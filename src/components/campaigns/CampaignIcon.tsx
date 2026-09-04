"use client";

import { useState } from "react";

function initialsForCampaign(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "C";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

export function CampaignIcon({
  name,
  color,
  iconUrl,
  size = "md",
}: {
  name: string;
  color: string;
  iconUrl?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(iconUrl && iconUrl !== failedUrl);

  return (
    <span
      className={`campaign-icon campaign-icon-${size}`}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    >
      {showImage ? (
        // Campaigns may host their logos anywhere, so this cannot use Next's
        // host-restricted image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={iconUrl!} alt="" onError={() => setFailedUrl(iconUrl!)} />
      ) : (
        <span>{initialsForCampaign(name)}</span>
      )}
    </span>
  );
}
