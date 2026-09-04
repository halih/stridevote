"use client";

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { GeoJSON, MapContainer, Polygon, TileLayer, Tooltip, useMap } from "react-leaflet";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import "leaflet/dist/leaflet.css";
import type { PrecinctOverlay } from "@/lib/precinct-geometry";
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
  enabled,
}: {
  onChange: TurfMapEditorProps["onChange"];
  resetKey?: number;
  enabled: boolean;
}) {
  const map = useMap();
  const onChangeRef = useRef(onChange);
  const pendingLayer = useRef<L.Layer | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled) {
      map.pm.removeControls();
      return;
    }
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
    // Edit/Eraser Finish only toggles the same tool off. Polygon Finish is the
    // one that actually closes the shape, so keep it and give it a clearer name.
    map.pm.setLang("en", { actions: { finish: "Complete shape" } }, "en");
    map.pm.Toolbar.changeActionsOfControl("drawPolygon", [
      "finish",
      "removeLastVertex",
      "cancel",
    ]);
    map.pm.Toolbar.changeActionsOfControl("editMode", []);
    map.pm.Toolbar.changeActionsOfControl("removalMode", []);
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

    // Geoman labels each tool with a `title` on its button container, which the
    // browser only reveals after a hover delay. Move it to `data-tip` so CSS can
    // show it instantly, and re-apply whenever Geoman rebuilds the toolbar.
    const container = map.getContainer();
    const applyInstantTips = () => {
      container
        .querySelectorAll<HTMLElement>(".leaflet-pm-toolbar .button-container[title]")
        .forEach((node) => {
          const title = node.getAttribute("title");
          if (!title) return;
          node.setAttribute("data-tip", title);
          node.removeAttribute("title");
          node
            .querySelector("a.leaflet-buttons-control-button")
            ?.setAttribute("aria-label", title);
        });
    };
    applyInstantTips();
    const observer = new MutationObserver(applyInstantTips);
    observer.observe(container, {
      subtree: true,
      childList: true,
      attributeFilter: ["title"],
    });

    return () => {
      observer.disconnect();
      map.off("pm:create", handleCreate);
      map.off("pm:edit", handleEdit);
      map.off("pm:remove", handleRemove);
      map.pm.removeControls();
    };
  }, [enabled, map]);

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

function PrecinctLayer({
  precincts,
  selectedIds,
  interactive,
  onSelect,
}: {
  precincts: PrecinctOverlay[];
  selectedIds: string[];
  interactive: boolean;
  onSelect?: (precinct: PrecinctOverlay) => void;
}) {
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const byId = useMemo(
    () => new Map(precincts.map((precinct) => [precinct.id, precinct])),
    [precincts],
  );
  const data = useMemo(
    () =>
      ({
        type: "FeatureCollection",
        features: precincts.map((precinct) => ({
          type: "Feature",
          properties: {
            id: precinct.id,
            name: precinct.name,
            selectable: precinct.selectable,
          },
          geometry: precinct.geometry,
        })),
      }) as GeoJSON.FeatureCollection,
    [precincts],
  );

  if (!precincts.length) return null;

  return (
    <GeoJSON
      key={`${interactive ? "pick" : "draw"}-${selectedIds.join(",")}-${precincts.length}`}
      data={data}
      interactive={interactive}
      style={(feature) => {
        const isSelected = selected.has(String(feature?.properties?.id ?? ""));
        const selectable = Boolean(feature?.properties?.selectable);
        return {
          color: isSelected ? "#185fa5" : "#6b7380",
          fillColor: isSelected ? "#378add" : "#8a8f98",
          fillOpacity: isSelected ? 0.28 : selectable ? 0.07 : 0.03,
          weight: isSelected ? 2.5 : 1,
        };
      }}
      onEachFeature={(feature, layer) => {
        (layer as L.Path & { options: L.PathOptions & { pmIgnore?: boolean } }).options.pmIgnore =
          true;
        const id = String(feature.properties?.id ?? "");
        const precinct = byId.get(id);
        const label = String(feature.properties?.name ?? "Precinct");
        layer.bindTooltip(label, { sticky: true });
        layer.on("click", (event) => {
          L.DomEvent.stopPropagation(event);
          if (precinct) onSelect?.(precinct);
        });
      }}
    />
  );
}

export function LeafletTurfEditor({
  districtBoundary,
  districtColor,
  turfs,
  precincts = [],
  mode = "draw",
  selectedPrecinctIds = [],
  value,
  onChange,
  onSelectPrecinct,
  resetKey,
}: TurfMapEditorProps) {
  const center: [number, number] = districtBoundary[0] ?? [47.72, -122.34];
  const previewBoundary =
    selectedPrecinctIds.length === 1 && value && value.length >= 3 ? value : null;

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
          fillOpacity: 0.04,
          weight: 3,
          dashArray: "8 6",
          pmIgnore: true,
          interactive: false,
        }}
      >
        <Tooltip sticky>Campaign district</Tooltip>
      </Polygon>
      <PrecinctLayer
        precincts={precincts}
        selectedIds={selectedPrecinctIds}
        interactive={mode === "precinct"}
        onSelect={onSelectPrecinct}
      />
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
      {previewBoundary ? (
        <Polygon
          positions={previewBoundary}
          pathOptions={{
            color: "#185fa5",
            fillColor: "#378add",
            fillOpacity: 0.32,
            weight: 3,
            pmIgnore: true,
          }}
        />
      ) : null}
      <TurfDrawingControls
        onChange={onChange}
        resetKey={resetKey}
        enabled={mode === "draw"}
      />
      <FitDistrict points={districtBoundary} />
    </MapContainer>
  );
}
