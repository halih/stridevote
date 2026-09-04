"use client";

import { useEffect } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polygon,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MapProps } from "./types";

const TILE_URL =
  process.env.NEXT_PUBLIC_MAP_TILE_URL ??
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

const HOME_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/></svg>';

function homeIcon(inside?: boolean) {
  return L.divIcon({
    className: "",
    html: `<div class="home-pin${inside ? "" : " outside"}">${HOME_SVG}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    if (points.length === 1) {
      map.setView(points[0], 14);
    } else if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points), { padding: [24, 24] });
    }
    // Re-measure after the container settles (it was just mounted).
    const t = setTimeout(() => map.invalidateSize(), 120);
    return () => clearTimeout(t);
  }, [points, map]);
  return null;
}

export function LeafletMap({ polygons = [], markers = [], home }: MapProps) {
  const allPoints: [number, number][] = [
    ...polygons.flatMap((p) => p.points),
    ...markers.map((m) => [m.lat, m.lng] as [number, number]),
    ...(home ? [[home.lat, home.lng] as [number, number]] : []),
  ];
  const center: [number, number] = allPoints[0] ?? [47.72, -122.34];

  return (
    <MapContainer
      center={center}
      zoom={13}
      scrollWheelZoom={false}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        url={TILE_URL}
        attribution='&copy; OpenStreetMap contributors'
        maxZoom={19}
      />
      {polygons.map((p, i) => (
        <Polygon
          key={i}
          positions={p.points}
          pathOptions={{
            color: p.color,
            weight: 2,
            fillOpacity: p.fillOpacity ?? 0.18,
          }}
        />
      ))}
      {markers.map((m, i) => (
        <CircleMarker
          key={i}
          center={[m.lat, m.lng]}
          radius={m.current ? 7 : 5}
          pathOptions={{
            color: "#fff",
            weight: 2,
            fillColor: m.color,
            fillOpacity: 1,
          }}
        >
          {m.title ? <Tooltip direction="top">{m.title}</Tooltip> : null}
        </CircleMarker>
      ))}
      {home ? <Marker position={[home.lat, home.lng]} icon={homeIcon(home.inside)} interactive={false} /> : null}
      <FitBounds points={allPoints} />
    </MapContainer>
  );
}
