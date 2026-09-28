'use strict';

process.env.NODE_ENV = 'test';

const { haversineDistanceMeters, boundingBoxDegrees, isRealisticSpeed } = require('../src/utils/geoUtils');

describe('geoUtils', () => {
  describe('haversineDistanceMeters', () => {
    it('returns ~0 for identical points', () => {
      const distance = haversineDistanceMeters(52.5978, 9.0854, 52.5978, 9.0854);
      expect(distance).toBeCloseTo(0, 3);
    });

    it('returns a plausible distance for two known points (~1.1km apart)', () => {
      // Stolzenau, Germany area coordinates roughly 1km apart.
      const distance = haversineDistanceMeters(52.5978, 9.0854, 52.6068, 9.0854);
      expect(distance).toBeGreaterThan(900);
      expect(distance).toBeLessThan(1100);
    });
  });

  describe('boundingBoxDegrees', () => {
    it('produces a box centered on the input point', () => {
      const box = boundingBoxDegrees(52.5978, 9.0854, 1000);
      expect(box.minLat).toBeLessThan(52.5978);
      expect(box.maxLat).toBeGreaterThan(52.5978);
      expect(box.minLng).toBeLessThan(9.0854);
      expect(box.maxLng).toBeGreaterThan(9.0854);
    });
  });

  describe('isRealisticSpeed', () => {
    it('accepts a slow walking pace', () => {
      const now = Date.now();
      // ~10 meters moved over 10 seconds => 3.6 km/h
      const ok = isRealisticSpeed(52.5978, 9.0854, now - 10000, 52.59789, 9.0854, now);
      expect(ok).toBe(true);
    });

    it('rejects a teleport-like jump', () => {
      const now = Date.now();
      // ~50km moved in 2 seconds => impossible speed
      const ok = isRealisticSpeed(52.5978, 9.0854, now - 2000, 53.0, 9.5, now);
      expect(ok).toBe(false);
    });

    it('rejects a non-positive elapsed time', () => {
      const now = Date.now();
      const ok = isRealisticSpeed(52.5978, 9.0854, now, 52.5979, 9.0855, now - 1000);
      expect(ok).toBe(false);
    });
  });
});
