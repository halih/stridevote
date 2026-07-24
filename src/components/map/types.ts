export interface MapPolygon {
  points: [number, number][];
  color: string; // concrete hex color
  fillOpacity?: number;
}

export interface MapMarker {
  lat: number;
  lng: number;
  color: string;
  current?: boolean;
  title?: string;
}

export interface MapHome {
  lat: number;
  lng: number;
  inside?: boolean;
}

export interface MapProps {
  heightPx: number;
  polygons?: MapPolygon[];
  markers?: MapMarker[];
  home?: MapHome;
  caption?: string;
}
