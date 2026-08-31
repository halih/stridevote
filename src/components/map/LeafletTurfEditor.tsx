"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import { MapContainer, Polygon, TileLayer, Tooltip, useMap } from "react-leaflet";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import "leaflet/dist/leaflet.css";
import type { TurfMapEditorProps } from "./TurfMapEditor";

const TILE_URL =
  process.env.NEXT_PUBLIC_MAP_TILE_URL ??
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

function polygonPoints(layer: L.Layer): [number, number][] | null {
  if (!(layer instanceof L.Polygon)) return null;
  const rings = layer.getLatLngs();
  const first = rings[0];
  if (!Array.isArray(first)) return null;
  const ring = first as L.LatLng[];
  return ring.map((point) => [point.lat, point.lng]);
}

function TurfDrawingControls({
  onChange,
  resetKey,
}: {
  onChange: TurfMapEditorProps["onChange"];
  resetKey?: number;
}) {
  const map = useMap();
  const onChangeRef = useRef(onChange);
  const pendingLayer = useRef<L.Layer | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    map.pm.addControls({
      position: "topright",
      drawPolygon: true,
      drawMarker: false,
      drawCircle: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawRectangle: false,
      drawText: false,
      editMode: true,
      dragMode: false,
      cutPolygon: false,
      removalMode: true,
      rotateMode: false,
    });
    map.pm.setGlobalOptions({
      snappable: true,
      snapDistance: 16,
      allowSelfIntersection: false,
      pathOptions: {
        color: "#185fa5",
        fillColor: "#378add",
        fillOpacity: 0.3,
        weight: 3,
      },
    });

    const handleCreate = (event: L.LeafletEvent & { layer: L.Layer }) => {
      if (pendingLayer.current && pendingLayer.current !== event.layer) {
        map.removeLayer(pendingLayer.current);
      }
      pendingLayer.current = event.layer;
      onChangeRef.current(polygonPoints(event.layer));
    };
    const handleEdit = (event: L.LeafletEvent & { layer: L.Layer }) => {
      if (event.layer === pendingLayer.current) {
        onChangeRef.current(polygonPoints(event.layer));
      }
    };
    const handleRemove = (event: L.LeafletEvent & { layer: L.Layer }) => {
      if (event.layer === pendingLayer.current) {
        pendingLayer.current = null;
        onChangeRef.current(null);
      }
    };

    map.on("pm:create", handleCreate);
    map.on("pm:edit", handleEdit);
    map.on("pm:remove", handleRemove);
    return () => {
      map.off("pm:create", handleCreate);
      map.off("pm:edit", handleEdit);
      map.off("pm:remove", handleRemove);
      map.pm.removeControls();
    };
  }, [map]);

  useEffect(() => {
    if (pendingLayer.current) {
      map.removeLayer(pendingLayer.current);
      pendingLayer.current = null;
    }
  }, [map, resetKey]);

  return null;
}

function FitDistrict({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    if (points.length >= 3) {
      map.fitBounds(L.latLngBounds(points), { padding: [28, 28] });
    }
    const timer = setTimeout(() => map.invalidateSize(), 120);
    return () => clearTimeout(timer);
  }, [map, points]);
  return null;
}

export function LeafletTurfEditor({
  districtBoundary,
  districtColor,
  turfs,
  onChange,
  resetKey,
}: TurfMapEditorProps) {
  const center: [number, number] = districtBoundary[0] ?? [47.72, -122.34];

  return (
    <MapContainer
      center={center}
      zoom={12}
      scrollWheelZoom
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        url={TILE_URL}
        attribution="&copy; OpenStreetMap contributors"
        maxZoom={19}
      />
      <Polygon
        positions={districtBoundary}
        pathOptions={{
          color: districtColor,
          fillColor: districtColor,
          fillOpacity: 0.05,
          weight: 3,
          dashArray: "8 6",
          pmIgnore: true,
        }}
      >
        <Tooltip sticky>Campaign district</Tooltip>
      </Polygon>
      {turfs.map((turf) => (
        <Polygon
          key={turf.id}
          positions={turf.boundary}
          pathOptions={{
            color: turf.color,
            fillColor: turf.color,
            fillOpacity: turf.fillOpacity ?? 0.2,
            weight: 2,
            pmIgnore: true,
          }}
        >
          <Tooltip sticky>{turf.name}</Tooltip>
        </Polygon>
      ))}
      <TurfDrawingControls onChange={onChange} resetKey={resetKey} />
      <FitDistrict points={districtBoundary} />
    </MapContainer>
  );
}
