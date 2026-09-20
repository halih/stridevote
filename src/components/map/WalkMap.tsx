"use client";

import { useEffect, useRef } from "react";
import {
  type GeoJSONSource,
  Map as MapLibreMap,
  type MapMouseEvent,
  Marker,
  type Marker as MapLibreMarker,
  NavigationControl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MapMarker, MapProps } from "./types";

const TILE_URL = (
  process.env.NEXT_PUBLIC_MAP_TILE_URL ??
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
).replace("{s}", "a");

const HOME_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/></svg>';

const YOU_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 21 21l-9-4-9 4 9-18.5Z" fill="currentColor" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>';

function polygonsGeoJson(polygons: NonNullable<MapProps["polygons"]>) {
  return {
    type: "FeatureCollection" as const,
    features: polygons
      .filter((polygon) => polygon.points.length >= 3)
      .map((polygon, index) => ({
        type: "Feature" as const,
        id: index,
        properties: {
          color: polygon.color,
          fillOpacity: polygon.fillOpacity ?? 0.18,
          weight: polygon.weight ?? 2,
        },
        geometry: {
          type: "Polygon" as const,
          coordinates: [[
            ...polygon.points.map(([lat, lng]) => [lng, lat]),
            [polygon.points[0]![1], polygon.points[0]![0]],
          ]],
        },
      })),
  };
}

function doorElement(marker: MapMarker, tappable: boolean): HTMLElement {
  const element = document.createElement(tappable ? "button" : "div");
  const count = marker.count ?? 1;
  element.className = `walk-map-door${marker.current ? " current" : ""}`;
  element.style.setProperty("--door-color", marker.color);
  element.title = marker.title ?? "";
  if (element instanceof HTMLButtonElement) {
    element.type = "button";
    element.setAttribute("aria-label", marker.title ?? "Select door");
  }
  if (count > 1) {
    element.classList.add("counted");
    element.textContent = String(count);
  }
  return element;
}

function pinElement(kind: "home" | "you", outside = false): HTMLElement {
  const element = document.createElement("div");
  element.className =
    kind === "home"
      ? `home-pin${outside ? " outside" : ""}`
      : "you-pin";
  element.title = kind === "home" ? "Home" : "Current location";
  element.innerHTML = kind === "home" ? HOME_SVG : YOU_SVG;
  return element;
}

/**
 * The walk map is torn down whenever the screen swaps to the list or reloads the
 * packet. Remembering the camera per walk keeps the volunteer's own framing
 * instead of jumping back to the selected door on every remount.
 */
let savedCamera: {
  key: string;
  center: [number, number];
  zoom: number;
  bearing: number;
} | null = null;

function nearestMarker(
  map: MapLibreMap,
  point: { x: number; y: number },
  markers: MapMarker[],
): MapMarker | null {
  let best: { marker: MapMarker; distance: number } | null = null;
  for (const marker of markers) {
    const projected = map.project([marker.lng, marker.lat]);
    const distance = Math.hypot(projected.x - point.x, projected.y - point.y);
    if (distance <= 24 && (!best || distance < best.distance)) {
      best = { marker, distance };
    }
  }
  return best?.marker ?? null;
}

export function WalkMap({
  polygons = [],
  markers = [],
  home,
  you,
  onMarkerClick,
  followSelection,
  cameraKey,
}: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const doorMarkersRef = useRef<MapLibreMarker[]>([]);
  const homeMarkerRef = useRef<MapLibreMarker | null>(null);
  const youMarkerRef = useRef<MapLibreMarker | null>(null);
  const markersRef = useRef(markers);
  const onMarkerClickRef = useRef(onMarkerClick);
  const cameraKeyRef = useRef(cameraKey);
  // The opening camera already frames the selection, so only later steps pan.
  const lastFollowRef = useRef(followSelection);

  useEffect(() => {
    cameraKeyRef.current = cameraKey;
  }, [cameraKey]);

  useEffect(() => {
    markersRef.current = markers;
  }, [markers]);

  useEffect(() => {
    onMarkerClickRef.current = onMarkerClick;
  }, [onMarkerClick]);

  useEffect(() => {
    if (!containerRef.current) return;
    const selected = markersRef.current.find((marker) => marker.current);
    const first = selected ?? markersRef.current[0];
    const resumed =
      cameraKey && savedCamera?.key === cameraKey ? savedCamera : null;
    const initial =
      resumed?.center ??
      (first
        ? ([first.lng, first.lat] as [number, number])
        : you
          ? ([you.lng, you.lat] as [number, number])
          : ([-122.34, 47.72] as [number, number]));
    const map = new MapLibreMap({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: [TILE_URL],
            tileSize: 256,
            maxzoom: 19,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: initial,
      zoom: resumed?.zoom ?? (first ? 18 : 15),
      bearing: resumed?.bearing ?? 0,
      dragRotate: true,
      touchZoomRotate: true,
      pitchWithRotate: false,
      maxPitch: 0,
    });
    map.touchZoomRotate.enableRotation();
    map.addControl(
      new NavigationControl({
        showCompass: true,
        showZoom: true,
        visualizePitch: false,
      }),
      "top-left",
    );
    map.on("load", () => {
      map.addSource("walk-polygons", {
        type: "geojson",
        data: polygonsGeoJson([]),
      });
      map.addLayer({
        id: "walk-polygon-fill",
        type: "fill",
        source: "walk-polygons",
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": ["get", "fillOpacity"],
        },
      });
      map.addLayer({
        id: "walk-polygon-line",
        type: "line",
        source: "walk-polygons",
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["get", "weight"],
        },
      });
    });
    map.on("click", (event: MapMouseEvent) => {
      const picked = nearestMarker(map, event.point, markersRef.current);
      if (picked) onMarkerClickRef.current?.(picked);
    });
    const rememberCamera = () => {
      if (!cameraKeyRef.current) return;
      const center = map.getCenter();
      savedCamera = {
        key: cameraKeyRef.current,
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
      };
    };
    map.on("moveend", rememberCamera);
    map.on("zoomend", rememberCamera);
    map.on("rotateend", rememberCamera);
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);
    mapRef.current = map;
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  // The map owns its camera for its lifetime; prop updates are handled below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      const source = map.getSource("walk-polygons") as GeoJSONSource | undefined;
      source?.setData(polygonsGeoJson(polygons));
    };
    if (map.loaded()) update();
    else map.once("load", update);
  }, [polygons]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const marker of doorMarkersRef.current) marker.remove();
    doorMarkersRef.current = markers.map((marker) => {
      const element = doorElement(marker, Boolean(onMarkerClick));
      if (onMarkerClick) {
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          onMarkerClickRef.current?.(marker);
        });
      }
      return new Marker({ element, anchor: "center" })
        .setLngLat([marker.lng, marker.lat])
        .addTo(map);
    });
  }, [markers, onMarkerClick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (followSelection === lastFollowRef.current) return;
    lastFollowRef.current = followSelection;
    const selected = markersRef.current.find((marker) => marker.current);
    if (!selected) return;
    // Stepping along a block usually keeps the next door on screen already.
    if (map.getBounds().contains([selected.lng, selected.lat])) return;
    map.panTo([selected.lng, selected.lat]);
  }, [followSelection]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!home) {
      homeMarkerRef.current?.remove();
      homeMarkerRef.current = null;
    } else if (homeMarkerRef.current) {
      homeMarkerRef.current.setLngLat([home.lng, home.lat]);
    } else {
      homeMarkerRef.current = new Marker({
          element: pinElement("home", home.inside === false),
          anchor: "center",
        })
          .setLngLat([home.lng, home.lat])
          .addTo(map);
    }
  }, [home]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!you) {
      youMarkerRef.current?.remove();
      youMarkerRef.current = null;
    } else if (youMarkerRef.current) {
      youMarkerRef.current
        .setLngLat([you.lng, you.lat])
        .setRotation(you.heading ?? 0);
    } else {
      youMarkerRef.current = new Marker({
          element: pinElement("you"),
          anchor: "center",
          rotation: you.heading ?? 0,
          rotationAlignment: "map",
        })
          .setLngLat([you.lng, you.lat])
          .addTo(map);
    }
  }, [you]);

  return <div ref={containerRef} className="walk-maplibre" />;
}
