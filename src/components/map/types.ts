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
}
