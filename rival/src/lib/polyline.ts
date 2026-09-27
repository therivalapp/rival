// Google encoded polyline (what Strava sends) → [[lat, lng], ...].
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let idx = 0, lat = 0, lng = 0;
  while (idx < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/** Projects a route into a width × height box with padding, keeping its shape
 *  (longitude is scaled by cos(latitude) so routes aren't stretched sideways). */
export function projectRoute(points: [number, number][], width: number, height: number, pad = 16): [number, number][] {
  if (points.length < 2) return [];
  const midLat = (points.reduce((s, p) => s + p[0], 0) / points.length) * (Math.PI / 180);
  const kx = Math.cos(midLat);
  const xs = points.map((p) => p[1] * kx);
  const ys = points.map((p) => -p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1e-9;
  const spanY = maxY - minY || 1e-9;
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  return xs.map((x, i) => [offX + (x - minX) * scale, offY + (ys[i] - minY) * scale]);
}
