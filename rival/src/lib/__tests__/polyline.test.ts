import { describe, expect, it } from 'vitest';
import { decodePolyline, projectRoute } from '../polyline';

describe('decodePolyline', () => {
  it('decodes the reference example from the Google polyline spec', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  });
});

describe('projectRoute', () => {
  it('keeps every point inside the padded box', () => {
    const pts = projectRoute(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), 400, 300, 20);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(19.9); expect(x).toBeLessThanOrEqual(380.1);
      expect(y).toBeGreaterThanOrEqual(19.9); expect(y).toBeLessThanOrEqual(280.1);
    }
  });
  it('returns nothing for a single point', () => {
    expect(projectRoute([[1, 1]], 400, 300)).toEqual([]);
  });
});
