import { describe, expect, it } from 'vitest';

import { decodeEncodedPolyline, encodeEncodedPolyline, PolylineDecodeError } from './polyline';

describe('decodeEncodedPolyline', () => {
  it('decodes with supplied precision into [longitude, latitude] order', () => {
    const original = [
      [13.405, 52.52],
      [13.41, 52.525],
      [11.582, 48.135],
    ] as const;
    const encoded = encodeEncodedPolyline(original, 6);
    const decoded = decodeEncodedPolyline(encoded, 6);
    expect(decoded).toHaveLength(3);
    for (const [index, pair] of decoded.entries()) {
      expect(pair[0]).toBeCloseTo(original[index]![0], 5);
      expect(pair[1]).toBeCloseTo(original[index]![1], 5);
    }
    // Longitude first — Berlin longitude ~13, not ~52.
    expect(decoded[0]![0]).toBeGreaterThan(10);
    expect(decoded[0]![0]).toBeLessThan(20);
    expect(decoded[0]![1]).toBeGreaterThan(50);
  });

  it('uses the provided precision rather than hard-coding 5', () => {
    const coords = [[2.3522, 48.8566]] as const;
    const p5 = encodeEncodedPolyline(coords, 5);
    const p6 = encodeEncodedPolyline(coords, 6);
    expect(p5).not.toEqual(p6);
    const d5 = decodeEncodedPolyline(p5, 5);
    const d6 = decodeEncodedPolyline(p6, 6);
    expect(d5[0]![0]).toBeCloseTo(2.3522, 4);
    expect(d6[0]![0]).toBeCloseTo(2.3522, 5);
  });

  it('rejects malformed and out-of-range input', () => {
    expect(() => decodeEncodedPolyline('', 6)).toThrow(PolylineDecodeError);
    expect(() => decodeEncodedPolyline('abc', 0)).toThrow(PolylineDecodeError);
    expect(() => decodeEncodedPolyline('_p~iF', 6)).toThrow(PolylineDecodeError);
  });
});
