// Shared geo utilities used by telemetry + shadow map services

export const TILE_SIZE_DEGREES = 200 / 111_320; // ~200 m in latitude-degrees

export function snapToGrid(val: number): number {
  return Math.floor(val / TILE_SIZE_DEGREES) * TILE_SIZE_DEGREES;
}

export function tileId(lat: number, lng: number): string {
  return `grid:${snapToGrid(lat).toFixed(6)}:${snapToGrid(lng).toFixed(6)}`;
}

/** Returns the [south, west, north, east] bounding box for a tile */
export function tileBbox(lat: number, lng: number): [number, number, number, number] {
  const south = snapToGrid(lat);
  const west  = snapToGrid(lng);
  return [south, west, south + TILE_SIZE_DEGREES, west + TILE_SIZE_DEGREES];
}

/** Haversine distance in metres between two coordinates */
export function distanceMetres(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R  = 6_371_000;
  const dL = (lat2 - lat1) * Math.PI / 180;
  const dO = (lng2 - lng1) * Math.PI / 180;
  const a  =
    Math.sin(dL / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dO / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
