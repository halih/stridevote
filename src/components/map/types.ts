export interface MapPolygon {
  points: [number, number][];
  color: string; // concrete hex color
  fillOpacity?: number;
  weight?: number;
  dashArray?: string;
}

export interface MapMarker {
  lat: number;
  lng: number;
  color: string;
  current?: boolean;
  title?: string;
  /** Number of doors represented by this pin (for apartment buildings). */
  count?: number;
  /** Stable id (e.g. householdId) for click selection. */
  id?: string;
}

export interface MapHome {
  lat: number;
  lng: number;
  /** When false, home pin uses the muted "outside region" style. */
  inside?: boolean;
}

/** Live GPS pin (distinct icon from profile home). */
export interface MapYou {
  lat: number;
  lng: number;
  /** Direction of travel clockwise from true north, when GPS can determine it. */
  heading?: number | null;
  accuracy?: number | null;
}

/**
 * A requested camera framing. Walk maps apply it when `seq` changes, so the
 * same bounds can be re-requested by bumping the sequence.
 */
export interface MapCameraRequest {
  seq: number;
  /** [lat, lng] south-west and north-east corners. */
  bounds: [[number, number], [number, number]];
  /** Never zoom in past this when the bounds are tiny. */
  maxZoom?: number;
}

import type { Basemap } from "./basemap";

export interface MapProps {
  /** Width-to-height ratio. Defaults to 4:3. */
  aspectRatio?: number;
  /** Show the street / satellite switch over the map. */
  basemapToggle?: boolean;
  /** Which tiles to draw. Set by `Map` from the saved preference. */
  basemap?: Basemap;
  /** Show a button that re-centres the map on `you` (hidden without a fix). */
  locateButton?: boolean;
  /** Bumped by `Map` when the locate button is pressed. */
  locateSeq?: number;
  polygons?: MapPolygon[];
  markers?: MapMarker[];
  /** Profile / saved home location. */
  home?: MapHome;
  /** Live / current GPS location. */
  you?: MapYou;
  caption?: string;
  /** Fired when a door/list marker is clicked. */
  onMarkerClick?: (marker: MapMarker) => void;
  /** Walking maps preserve the user's camera and support touch rotation. */
  mode?: "overview" | "walk";
  /**
   * Bumped when the walker steps to another door (prev/next). The camera follows
   * the selection only on those steps, so panning the map by hand sticks.
   */
  followSelection?: number;
  /**
   * Identifies the walk this camera belongs to. The map restores the camera the
   * volunteer left behind when it remounts (view toggle, refresh) under the same
   * key, instead of snapping back to the selected door.
   */
  cameraKey?: string;
  /**
   * Opening framing for a walk. Applied on mount (unless a camera is being
   * restored under `cameraKey`) and again whenever `seq` changes, as long as
   * the volunteer has not moved the map by hand yet.
   */
  camera?: MapCameraRequest;
}
