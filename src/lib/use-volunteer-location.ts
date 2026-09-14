"use client";

import { useEffect, useState } from "react";

export type VolunteerHome = { lat: number; lng: number } | null;

export type VolunteerLocation = {
  /** Profile / saved home. */
  home: VolunteerHome;
  /** Live GPS when the browser grants it. */
  you: { lat: number; lng: number } | null;
  /** Preferred point for distance: live → home → null. */
  origin: { lat: number; lng: number } | null;
  originSource: "gps" | "profile" | "none";
};

/**
 * Shared volunteer map location: profile home plus optional live GPS.
 * Live updates do not replace home — maps can show both with distinct pins.
 */
export function useVolunteerLocation(home: VolunteerHome): VolunteerLocation {
  const [you, setYou] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    let cancelled = false;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (cancelled) return;
        setYou({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        // Keep profile home only.
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 10_000 },
    );
    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  return {
    home,
    you,
    origin: you ?? home,
    originSource: you ? "gps" : home ? "profile" : "none",
  };
}
