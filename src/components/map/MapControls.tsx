"use client";

import { Icon } from "@/components/Icon";
import type { Basemap } from "./basemap";

/**
 * Buttons stacked in the map's top-right corner: the street / satellite switch
 * and, when there is a GPS fix to go to, a re-centre button.
 */
export function MapControls({
  basemap,
  onBasemapChange,
  onLocate,
}: {
  basemap?: Basemap;
  onBasemapChange?: (next: Basemap) => void;
  onLocate?: () => void;
}) {
  if (!onBasemapChange && !onLocate) return null;
  const satellite = basemap === "satellite";
  const basemapLabel = satellite
    ? "Switch to street map"
    : "Switch to satellite view";
  return (
    <div className="map-controls">
      {onBasemapChange ? (
        <button
          type="button"
          className={`map-ctrl-btn map-basemap-btn${satellite ? " active" : ""}`}
          aria-label={basemapLabel}
          aria-pressed={satellite}
          title={basemapLabel}
          onClick={() => onBasemapChange(satellite ? "street" : "satellite")}
        >
          <Icon name="layers" size={15} />
        </button>
      ) : null}
      {onLocate ? (
        <button
          type="button"
          className="map-ctrl-btn map-locate-btn"
          aria-label="Centre on my location"
          title="Centre on my location"
          onClick={onLocate}
        >
          <Icon name="locate" size={15} />
        </button>
      ) : null}
    </div>
  );
}
