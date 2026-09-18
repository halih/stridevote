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

export interface MapProps {
  /** Width-to-height ratio. Defaults to 4:3. */
  aspectRatio?: number;
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
}
