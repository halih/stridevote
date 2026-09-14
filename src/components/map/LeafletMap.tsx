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
import type { MapMarker, MapProps } from "./types";

const TILE_URL =
  process.env.NEXT_PUBLIC_MAP_TILE_URL ??
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

const HOME_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/></svg>';

const YOU_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 21 21l-9-4-9 4 9-18.5Z" fill="currentColor" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>';

function homeIcon(inside?: boolean) {
  return L.divIcon({
    className: "",
    html: `<div class="home-pin${inside === false ? " outside" : ""}" title="Home">${HOME_SVG}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function youIcon() {
  return L.divIcon({
    className: "",
    html: `<div class="you-pin" title="Current location">${YOU_SVG}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const pointsKey = points.map(([lat, lng]) => `${lat},${lng}`).join("|");
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
    // pointsKey tracks geometry; avoid re-fitting when only selection styling changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- points derived from pointsKey
  }, [pointsKey, map]);
  return null;
}

export function LeafletMap({
  polygons = [],
  markers = [],
  home,
  you,
  onMarkerClick,
}: MapProps) {
  // Fit to turf/doors only — home & live GPS stay visible but don't yank the frame.
  const fitPoints: [number, number][] = [
    ...polygons.flatMap((p) => p.points),
    ...markers.map((m) => [m.lat, m.lng] as [number, number]),
  ];
  const center: [number, number] = fitPoints[0] ?? [47.72, -122.34];

  // Draw selected last so it sits on top.
  const ordered = [
    ...markers.filter((m) => !m.current),
    ...markers.filter((m) => m.current),
  ];

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
            weight: p.weight ?? 2,
            fillOpacity: p.fillOpacity ?? 0.18,
            dashArray: p.dashArray,
          }}
        />
      ))}
      {ordered.map((m, i) => (
        <DoorMarker
          key={m.id ?? `${m.lat},${m.lng},${i}`}
          marker={m}
          onClick={onMarkerClick}
        />
      ))}
      {home ? (
        <Marker position={[home.lat, home.lng]} icon={homeIcon(home.inside)} interactive={false} />
      ) : null}
      {you ? (
        <Marker position={[you.lat, you.lng]} icon={youIcon()} interactive={false} />
      ) : null}
      <FitBounds points={fitPoints} />
    </MapContainer>
  );
}

function DoorMarker({
  marker: m,
  onClick,
}: {
  marker: MapMarker;
  onClick?: (marker: MapMarker) => void;
}) {
  return (
    <>
      {m.current ? (
        <CircleMarker
          center={[m.lat, m.lng]}
          radius={11}
          pathOptions={{
            color: m.color,
            weight: 0,
            fillColor: m.color,
            fillOpacity: 0.2,
          }}
          interactive={false}
        />
      ) : null}
      <CircleMarker
        center={[m.lat, m.lng]}
        radius={m.current ? 8 : 5}
        pathOptions={{
          color: m.current ? "#0f1216" : "#fff",
          weight: m.current ? 2.5 : 2,
          fillColor: m.color,
          fillOpacity: 1,
        }}
        eventHandlers={
          onClick
            ? {
                click: (event) => {
                  L.DomEvent.stopPropagation(event);
                  onClick(m);
                },
              }
            : undefined
        }
      >
        {m.title ? (
          <Tooltip direction="top" offset={[0, m.current ? -10 : -4]}>
            {m.title}
          </Tooltip>
        ) : null}
      </CircleMarker>
    </>
  );
}
