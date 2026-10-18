import { Platform } from 'react-native';
import { gunzipSync, strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { supabase } from './supabase';
import { buildDataExport } from './exportData';
import { encodePolyline } from './polyline';
import { getSeasonStartISO } from './season';

// Archives (Ricky, 2026-10-17): a RIVAL archive to keep before deleting an
// account, and reading a RIVAL or Strava archive back in.
//
// A RIVAL archive is a .zip: data.json (everything "Download my data" holds),
// routes.json (activity id → encoded route) and photos/<activity id>.<ext>.
// It is built in the app and saved straight away, so nothing waits on email
// and the archive exists before any deletion can start.

export type ArchiveCounts = { activities: number; photos: number; routes: number };

function saveBlob(data: Uint8Array, filename: string, type: string): boolean {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return false;
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

export async function buildArchive(userId: string, email: string | null, onProgress?: (done: number, total: number) => void): Promise<ArchiveCounts> {
  const { json } = await buildDataExport(userId, email);
  const data = JSON.parse(json);
  const activities: any[] = data.activities ?? [];

  const routes: Record<string, string> = {};
  for (let from = 0; ; from += 1000) {
    const { data: rows } = await supabase.from('activity_routes').select('activity_id, polyline').eq('user_id', userId).range(from, from + 999);
    (rows ?? []).forEach((r: any) => { if (r.polyline) routes[r.activity_id] = r.polyline; });
    if (!rows || rows.length < 1000) break;
  }

  const files: Zippable = {
    'data.json': strToU8(json),
    'routes.json': strToU8(JSON.stringify(routes)),
  };
  const withPhotos = activities.filter((a) => a.photo_url);
  let photos = 0;
  for (let i = 0; i < withPhotos.length; i++) {
    const a = withPhotos[i];
    try {
      const res = await fetch(a.photo_url);
      if (res.ok) {
        const ext = (res.headers.get('content-type') || '').includes('png') ? 'png' : 'jpg';
        // Photos are already compressed: stored, not re-compressed.
        files[`photos/${a.id}.${ext}`] = [new Uint8Array(await res.arrayBuffer()), { level: 0 }];
        photos++;
      }
    } catch { /* a missing photo never stops the archive */ }
    onProgress?.(i + 1, withPhotos.length);
  }
  const zip = zipSync(files, { level: 6 });
  saveBlob(zip, `rival-archive-${new Date().toISOString().slice(0, 10)}.zip`, 'application/zip');
  return { activities: activities.length, photos, routes: Object.keys(routes).length };
}

// ---- Reading an archive -------------------------------------------------

export type ImportItem = {
  key: string;
  provider: 'strava' | 'rival_import';
  providerId: string;
  name: string | null;
  type: string;
  startedAt: string;
  utcOffsetSeconds?: number | null;
  durationSeconds: number;
  distanceMeters?: number | null;
  elevationMeters?: number | null;
  notes?: string | null;
  polyline?: string | null;
  photoPath?: string | null;
};

export type ReadArchive = {
  source: 'strava' | 'rival';
  items: ImportItem[];
  /** item key → photo bytes, uploaded only for items that turn out new. */
  photos: Map<string, { bytes: Uint8Array; ext: string }>;
};

/** One CSV line set into rows, handling quoted fields with commas and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/** Strava's "Oct 17, 2026, 7:02:32 AM" (UTC) → ISO. */
export function parseStravaDate(s: string): string | null {
  const m = s.match(/([A-Z][a-z]{2}) (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?/);
  if (!m) return null;
  let h = Number(m[4]) % 12;
  if (m[7] === 'PM') h += 12;
  if (!m[7]) h = Number(m[4]);
  const d = new Date(Date.UTC(Number(m[3]), MONTHS[m[1]] ?? 0, Number(m[2]), h, Number(m[5]), Number(m[6])));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function gpxToPolyline(xml: string): string | null {
  const pts: [number, number][] = [];
  const re = /<trkpt[^>]*\blat="([-\d.]+)"[^>]*\blon="([-\d.]+)"|<trkpt[^>]*\blon="([-\d.]+)"[^>]*\blat="([-\d.]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const lat = Number(m[1] ?? m[4]);
    const lon = Number(m[2] ?? m[3]);
    if (isFinite(lat) && isFinite(lon)) pts.push([lat, lon]);
  }
  if (pts.length < 2) return null;
  // Thin long recordings so the stored route stays small.
  const step = Math.max(1, Math.floor(pts.length / 1500));
  return encodePolyline(pts.filter((_, i) => i % step === 0 || i === pts.length - 1));
}

const num = (v: string | undefined) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return isFinite(n) ? n : 0;
};

export async function readArchive(file: Blob): Promise<ReadArchive> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(buf, {
    // Only what is needed: the activity list, routes and photos. FIT files
    // (binary) are skipped; their activity still imports, without a route.
    filter: (f) => /(^|\/)(activities\.csv|data\.json|routes\.json)$/.test(f.name)
      || /\.(gpx|gpx\.gz)$/i.test(f.name)
      || /\.(jpe?g|png|heic)$/i.test(f.name),
  });
  const find = (name: string) => Object.keys(entries).find((k) => k === name || k.endsWith(`/${name}`));
  const photos = new Map<string, { bytes: Uint8Array; ext: string }>();

  const csvName = find('activities.csv');
  if (csvName) {
    const rows = parseCsv(strFromU8(entries[csvName]));
    const head = rows[0] ?? [];
    const col = (name: string, last = false) => (last ? head.lastIndexOf(name) : head.indexOf(name));
    const iId = col('Activity ID'), iDate = col('Activity Date'), iName = col('Activity Name'), iType = col('Activity Type');
    const iDesc = col('Activity Description'), iElapsed = col('Elapsed Time'), iMoving = col('Moving Time');
    // "Distance" appears twice: first in the athlete's units, later in metres.
    const iDistM = col('Distance', true), iDistFirst = col('Distance');
    const iElev = col('Elevation Gain'), iFile = col('Filename'), iMedia = col('Media');
    const items: ImportItem[] = [];
    for (const r of rows.slice(1)) {
      const id = r[iId];
      const startedAt = parseStravaDate(r[iDate] ?? '');
      if (!id || !startedAt) continue;
      const moving = num(r[iMoving]) || num(r[iElapsed]);
      let meters = iDistM !== iDistFirst ? num(r[iDistM]) : num(r[iDistFirst]) * 1000;
      if (!meters && iDistFirst >= 0) meters = num(r[iDistFirst]) * 1000;
      const key = `s${id}`;
      let polyline: string | null = null;
      const fname = r[iFile];
      if (fname && /\.gpx(\.gz)?$/i.test(fname)) {
        const entry = find(fname.replace(/^\.?\//, ''));
        if (entry) {
          try {
            const raw = /\.gz$/i.test(fname) ? gunzipSync(entries[entry]) : entries[entry];
            polyline = gpxToPolyline(strFromU8(raw));
          } catch { /* unreadable route: import without it */ }
        }
      }
      const media = (r[iMedia] ?? '').split('|').map((m) => m.trim()).filter(Boolean);
      const photoEntry = media.map((m) => find(m.replace(/^\.?\//, ''))).find(Boolean);
      if (photoEntry) photos.set(key, { bytes: entries[photoEntry], ext: /png$/i.test(photoEntry) ? 'png' : 'jpg' });
      items.push({
        key, provider: 'strava', providerId: String(id),
        name: r[iName] || null,
        type: (r[iType] || 'Workout').replace(/\s+/g, ''),
        startedAt, durationSeconds: Math.round(moving),
        distanceMeters: meters > 0 ? meters : null,
        elevationMeters: num(r[iElev]) || null,
        notes: r[iDesc] || null,
        polyline,
      });
    }
    return { source: 'strava', items, photos };
  }

  const dataName = find('data.json');
  if (dataName) {
    const data = JSON.parse(strFromU8(entries[dataName]));
    const routesName = find('routes.json');
    const routes: Record<string, string> = routesName ? JSON.parse(strFromU8(entries[routesName])) : {};
    const items: ImportItem[] = [];
    for (const a of (data.activities ?? []) as any[]) {
      if (!a?.id || !a.started_at) continue;
      const key = `r${a.id}`;
      const photoEntry = Object.keys(entries).find((k) => k.includes(`photos/${a.id}.`));
      if (photoEntry) photos.set(key, { bytes: entries[photoEntry], ext: /png$/i.test(photoEntry) ? 'png' : 'jpg' });
      items.push({
        key,
        // Strava activities keep their Strava id, so they match a Strava sync.
        provider: a.provider === 'strava' && a.provider_activity_id ? 'strava' : 'rival_import',
        providerId: a.provider === 'strava' && a.provider_activity_id ? String(a.provider_activity_id) : String(a.id),
        name: a.name ?? null, type: a.activity_type, startedAt: a.started_at,
        utcOffsetSeconds: a.utc_offset_seconds ?? null,
        durationSeconds: a.duration_seconds ?? 0,
        distanceMeters: a.distance_meters ?? null, elevationMeters: a.elevation_meters ?? null,
        notes: a.notes ?? null, polyline: routes[a.id] ?? null,
      });
    }
    return { source: 'rival', items, photos };
  }
  throw new Error('not_an_archive');
}

async function callImport(body: unknown): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('signed_out');
  const res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/import-activities`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'import_failed');
  return data;
}

/** Which items are new to RIVAL, without writing anything. */
export async function previewImport(items: ImportItem[], onProgress?: (done: number) => void): Promise<Set<string>> {
  const fresh = new Set<string>();
  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50).map(({ polyline, ...rest }) => rest);
    const { results } = await callImport({ preview: true, items: batch });
    (results ?? []).forEach((r: any) => { if (r.status === 'new') fresh.add(r.key); });
    onProgress?.(Math.min(items.length, i + 50));
  }
  return fresh;
}

export type ImportResult = { key: string; status: string; id?: string; effort?: number };

/** Imports the given items, uploading each one's photo first. */
export async function runImport(userId: string, read: ReadArchive, items: ImportItem[], onProgress?: (done: number) => void): Promise<ImportResult[]> {
  const out: ImportResult[] = [];
  for (let i = 0; i < items.length; i += 10) {
    const batch = items.slice(i, i + 10);
    for (const it of batch) {
      const photo = read.photos.get(it.key);
      if (!photo) continue;
      const path = `${userId}/import/${it.providerId}.${photo.ext}`;
      const { error } = await supabase.storage.from('activity-photos')
        .upload(path, photo.bytes, { contentType: photo.ext === 'png' ? 'image/png' : 'image/jpeg', upsert: true });
      if (!error) it.photoPath = path;
    }
    const { results } = await callImport({ items: batch });
    out.push(...(results ?? []));
    onProgress?.(Math.min(items.length, i + 10));
  }
  return out;
}

/** This year's Effort, which sets the rank (same definition as Today). */
export async function fetchYearEffort(userId: string): Promise<number> {
  let total = 0;
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from('activities').select('effort_score')
      .eq('user_id', userId).gte('started_at', getSeasonStartISO()).range(from, from + 999);
    (data ?? []).forEach((a: any) => { total += a.effort_score || 0; });
    if (!data || data.length < 1000) return total;
  }
}
