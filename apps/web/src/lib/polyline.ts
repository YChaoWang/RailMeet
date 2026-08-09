/**
 * Decode a Google Encoded Polyline using the geometry's supplied precision.
 * Returns GeoJSON positions as [longitude, latitude].
 */

export type LonLat = readonly [longitude: number, latitude: number];

export class PolylineDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolylineDecodeError';
  }
}

function assertFiniteCoord(value: number, kind: 'longitude' | 'latitude'): void {
  if (!Number.isFinite(value)) {
    throw new PolylineDecodeError(`Non-finite ${kind} in encoded polyline`);
  }
  if (kind === 'longitude' && (value < -180 || value > 180)) {
    throw new PolylineDecodeError(`Longitude out of range: ${value}`);
  }
  if (kind === 'latitude' && (value < -90 || value > 90)) {
    throw new PolylineDecodeError(`Latitude out of range: ${value}`);
  }
}

/**
 * Decode Google Encoded Polyline Algorithm Format.
 * @param points Encoded string from MOTIS EncodedPolyline.points
 * @param precision Provider-supplied precision (typically 6 for MOTIS v5) — not hard-coded.
 */
export function decodeEncodedPolyline(points: string, precision: number): LonLat[] {
  if (typeof points !== 'string' || points.length === 0) {
    throw new PolylineDecodeError('Encoded polyline points must be a non-empty string');
  }
  if (!Number.isInteger(precision) || precision < 1 || precision > 10) {
    throw new PolylineDecodeError(`Unsupported polyline precision: ${precision}`);
  }

  const factor = 10 ** precision;
  const coordinates: LonLat[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < points.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= points.length) {
        throw new PolylineDecodeError('Truncated encoded polyline');
      }
      byte = points.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    result = 0;
    shift = 0;
    do {
      if (index >= points.length) {
        throw new PolylineDecodeError('Truncated encoded polyline');
      }
      byte = points.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    const latitude = lat / factor;
    const longitude = lng / factor;
    assertFiniteCoord(longitude, 'longitude');
    assertFiniteCoord(latitude, 'latitude');
    coordinates.push([longitude, latitude]);
  }

  return coordinates;
}

/** Encode helper for fixtures/tests only. */
export function encodeEncodedPolyline(coordinates: readonly LonLat[], precision: number): string {
  if (!Number.isInteger(precision) || precision < 1 || precision > 10) {
    throw new PolylineDecodeError(`Unsupported polyline precision: ${precision}`);
  }
  const factor = 10 ** precision;
  let lastLat = 0;
  let lastLng = 0;
  let result = '';

  const encodeSigned = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      result += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    result += String.fromCharCode(v + 63);
  };

  for (const [longitude, latitude] of coordinates) {
    const lat = Math.round(latitude * factor);
    const lng = Math.round(longitude * factor);
    encodeSigned(lat - lastLat);
    encodeSigned(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return result;
}
