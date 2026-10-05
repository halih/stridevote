"use client";

import { useEffect, useRef } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polygon,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvent,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { BASEMAP_TILES } from "./basemap";
import { nearestIndexWithin } from "./nearest";
import type { MapMarker, MapProps } from "./types";

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

function youIcon(heading?: number | null) {
  const rotation =
    heading != null && Number.isFinite(heading)
      ? ` style="transform:rotate(${heading}deg)"`
      : "";
  return L.divIcon({
    className: "",
    html: `<div class="you-pin" title="Current location"${rotation}>${YOU_SVG}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

/**
 * Centred on the dot rather than offset into a corner badge: a corner lands in
 * a different place per browser, and the middle of the dot needs no offset.
 */
function doorCountIcon(count: number) {
  return L.divIcon({
    className: "door-count-icon",
    html: `<span>${count}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function FitBounds({
  points,
  pointsKey,
}: {
  points: [number, number][];
  pointsKey: string;
}) {
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
    // pointsKey tracks geometry; avoid re-fitting when only selection styling changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- points derived from pointsKey
  }, [pointsKey, map]);
  return null;
}

/** How far inside the frame the selected door must sit to count as visible. */
const IN_VIEW_INSET = -0.12;

/**
 * Stepping through doors selects addresses the current frame may not cover, so
 * bring the selection back into view. A door that is already on screen is left
 * where it is — otherwise the map would lurch on every step along a block.
 */
function KeepSelectionInView({
  point,
  geometryKey,
}: {
  point: [number, number] | null;
  geometryKey: string;
}) {
  const map = useMap();
  const pointKey = point ? `${point[0]},${point[1]}` : null;
  const lastPoint = useRef<string | null | undefined>(undefined);
  const lastGeometry = useRef<string | undefined>(undefined);

  useEffect(() => {
    const previousPoint = lastPoint.current;
    const previousGeometry = lastGeometry.current;
    lastPoint.current = pointKey;
    lastGeometry.current = geometryKey;
    if (!pointKey || !point) return;
    // FitBounds frames the door set on the first paint and whenever the set
    // changes. Those fits already show the selection, so don't fight them.
    if (previousPoint === undefined || previousGeometry !== geometryKey) return;

    const target = L.latLng(point);
    if (map.getBounds().pad(IN_VIEW_INSET).contains(target)) return;
    map.panTo(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- point derived from pointKey
  }, [pointKey, geometryKey, map]);

  return null;
}

/** Centring on the volunteer from a wide view should land at street level. */
const LOCATE_MIN_ZOOM = 16;

/** Re-centres on the live GPS pin each time the locate button bumps `seq`. */
function CenterOnYou({
  you,
  seq,
}: {
  you: [number, number] | null;
  seq: number | undefined;
}) {
  const map = useMap();
  const youRef = useRef(you);
  const lastSeq = useRef(seq);

  useEffect(() => {
    youRef.current = you;
  }, [you]);

  useEffect(() => {
    if (seq === lastSeq.current) return;
    lastSeq.current = seq;
    if (!youRef.current) return;
    map.setView(youRef.current, Math.max(map.getZoom(), LOCATE_MIN_ZOOM), {
      animate: true,
    });
  }, [seq, map]);

  return null;
}

export function LeafletMap({
  polygons = [],
  markers = [],
  home,
  you,
  onMarkerClick,
  basemap = "street",
  locateSeq,
}: MapProps) {
  const tiles = BASEMAP_TILES[basemap];
  // Fit to turf/doors only — home & live GPS stay visible but don't yank the frame.
  const fitPoints: [number, number][] = [
    ...polygons.flatMap((p) => p.points),
    ...markers.map((m) => [m.lat, m.lng] as [number, number]),
  ];
  const center: [number, number] = fitPoints[0] ?? [47.72, -122.34];
  const fitKey = fitPoints.map(([lat, lng]) => `${lat},${lng}`).join("|");

  // Draw selected last so it sits on top.
  const ordered = [
    ...markers.filter((m) => !m.current),
    ...markers.filter((m) => m.current),
  ];
  const selected = markers.find((m) => m.current) ?? null;

  return (
    <MapContainer
      center={center}
      zoom={13}
      scrollWheelZoom={false}
      style={{ height: "100%", width: "100%" }}
    >
      {/* Attribution is only read when the layer is created, so remount it. */}
      <TileLayer
        key={basemap}
        url={tiles.url}
        attribution={tiles.attribution}
        maxZoom={tiles.maxZoom}
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
          tappable={Boolean(onMarkerClick)}
        />
      ))}
      {onMarkerClick ? (
        <NearestDoorTap markers={markers} onPick={onMarkerClick} />
      ) : null}
      {home ? (
        <Marker position={[home.lat, home.lng]} icon={homeIcon(home.inside)} interactive={false} />
      ) : null}
      {you ? (
        <Marker
          position={[you.lat, you.lng]}
          icon={youIcon(you.heading)}
          interactive={false}
        />
      ) : null}
      <FitBounds points={fitPoints} pointsKey={fitKey} />
      <KeepSelectionInView
        point={selected ? [selected.lat, selected.lng] : null}
        geometryKey={fitKey}
      />
      <CenterOnYou you={you ? [you.lat, you.lng] : null} seq={locateSeq} />
    </MapContainer>
  );
}

function DoorMarker({
  marker: m,
  tappable,
}: {
  marker: MapMarker;
  tappable: boolean;
}) {
  // Read-only overview maps (split preview, list editor) pack many doors into a
  // small frame, so they keep the compact dot. Walkable maps draw a bigger one.
  const baseRadius = m.current ? (tappable ? 11 : 8) : tappable ? 8 : 5;
  const count = m.count ?? 1;
  // A multi-door dot carries its count, so it has to be wide enough to hold it.
  const radius =
    count > 1 ? Math.max(baseRadius, 8 + String(count).length * 2) : baseRadius;

  return (
    <>
      {m.current ? (
        <CircleMarker
          center={[m.lat, m.lng]}
          radius={radius + 5}
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
        radius={radius}
        pathOptions={{
          color: m.current ? "#0f1216" : "#fff",
          weight: m.current ? 2.5 : 2,
          fillColor: m.color,
          fillOpacity: 1,
        }}
        // On tappable maps the dot must not be an event target at all. Leaflet
        // binds `click` to open a bound tooltip, and a layer that listens to
        // click stops the map from receiving it (Map._findEventTargets only
        // falls back to the map when no layer claimed the event) — which would
        // swallow the tap that NearestDoorTap needs.
        interactive={!tappable}
      >
        {m.title && !tappable ? (
          <Tooltip direction="top" offset={[0, -(radius + 2)]}>
            {m.title}
          </Tooltip>
        ) : null}
      </CircleMarker>
      {count > 1 ? (
        <Marker
          position={[m.lat, m.lng]}
          icon={doorCountIcon(count)}
          interactive={false}
          keyboard={false}
        />
      ) : null}
    </>
  );
}

/** Max distance from a tap to a door pin that still counts as tapping it. */
const TAP_SLOP_PX = 22;

/**
 * Door dots stay small enough to read a dense block, so tapping the dot itself
 * is fiddly on a phone. Resolve taps against the whole map instead and pick the
 * nearest pin — unlike per-pin hit areas, neighbours can't shadow each other.
 */
function NearestDoorTap({
  markers,
  onPick,
}: {
  markers: MapMarker[];
  onPick: (marker: MapMarker) => void;
}) {
  useMapEvent("click", (event) => {
    const map = event.target as L.Map;
    const index = nearestIndexWithin(
      map.latLngToContainerPoint(event.latlng),
      markers.map((m) => map.latLngToContainerPoint([m.lat, m.lng])),
      TAP_SLOP_PX,
    );
    if (index != null) onPick(markers[index]);
  });
  return null;
}
