"use client";

import { useEffect, useRef, useState } from "react";

export type VolunteerHome = { lat: number; lng: number } | null;

export type VolunteerLocation = {
  /** Profile / saved home. */
  home: VolunteerHome;
  /** Live GPS when the browser grants it. */
  you: {
    lat: number;
    lng: number;
    heading: number | null;
    accuracy: number | null;
  } | null;
  /** Preferred point for distance: live → home → null. */
  origin: { lat: number; lng: number } | null;
  originSource: "gps" | "profile" | "none";
};

type LocationSample = { lat: number; lng: number };

function distanceMeters(from: LocationSample, to: LocationSample): number {
  const radians = Math.PI / 180;
  const lat1 = from.lat * radians;
  const lat2 = to.lat * radians;
  const dLat = (to.lat - from.lat) * radians;
  const dLng = (to.lng - from.lng) * radians;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Direction clockwise from true north. */
export function headingBetween(from: LocationSample, to: LocationSample): number {
  const radians = Math.PI / 180;
  const lat1 = from.lat * radians;
  const lat2 = to.lat * radians;
  const dLng = (to.lng - from.lng) * radians;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) / radians + 360) % 360;
}

/**
 * Shared volunteer map location: profile home plus optional live GPS.
 * Live updates do not replace home — maps can show both with distinct pins.
 */
export function useVolunteerLocation(home: VolunteerHome): VolunteerLocation {
  const [you, setYou] = useState<VolunteerLocation["you"]>(null);
  const headingSample = useRef<LocationSample | null>(null);
  const lastHeading = useRef<number | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    let cancelled = false;
    let watchId: number | null = null;
    const options: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 1_000,
    };
    function onPosition(pos: GeolocationPosition) {
      if (cancelled) return;
      const next = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      };
      const nativeHeading = pos.coords.heading;
      if (nativeHeading != null && Number.isFinite(nativeHeading)) {
        lastHeading.current = nativeHeading;
        headingSample.current = next;
      } else if (!headingSample.current) {
        headingSample.current = next;
      } else if (distanceMeters(headingSample.current, next) >= 4) {
        lastHeading.current = headingBetween(headingSample.current, next);
        headingSample.current = next;
      }
      setYou({
        ...next,
        heading: lastHeading.current,
        accuracy: Number.isFinite(pos.coords.accuracy)
          ? pos.coords.accuracy
          : null,
      });
    }
    function onError() {
      // Keep profile home only; a later watch fix may still recover.
    }
    function startTracking() {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      // Some mobile browsers delay the first watch callback. Request an
      // immediate fix as well, then keep the watch alive for movement.
      navigator.geolocation.getCurrentPosition(onPosition, onError, options);
      watchId = navigator.geolocation.watchPosition(
        onPosition,
        onError,
        options,
      );
    }
    function onVisibilityChange() {
      // iOS may suspend a watch while the PWA is backgrounded.
      if (document.visibilityState === "visible") startTracking();
    }
    startTracking();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  return {
    home,
    you,
    origin: you ?? home,
    originSource: you ? "gps" : home ? "profile" : "none",
  };
}
