import { Platform } from 'react-native';
import { gunzipSync, strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { supabase } from './supabase';
import { fitPhoto } from './imageResize';
import { buildDataExport } from './exportData';
import { encodePolyline } from './polyline';
import { getSeasonStartISO } from './season';

// Archives (Ricky, 2026-10-17): a RIVAL archive to keep before deleting an
// account, and reading a RIVAL or Strava archive back in.
//
// A RIVAL archive is a .zip: data.json (everything "Download my data" holds),
// routes.json (activity id → encoded route), photos/<activity id>.<ext> (each
// activity's cover, which is what reading an archive back in uses), and
// media/<activity id>/<n>.<ext>, every other photo and video in posting
// order, listed in media.json (Ricky, 2026-10-24: nobody should lose their
// photos the way an Instagram lockout loses them).
// It is built in the app and saved straight away, so nothing waits on email
// and the archive exists before any deletion can start.

export type ArchiveCounts = { activities: number; photos: number; videos: number; routes: number };

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
  // Every photo and video on the person's activities, read by activity id in
  // batches (a long id list doesn't fit one request's URL).
  const ids = activities.map((a) => a.id).filter(Boolean);
  const media: any[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data: rows } = await supabase.from('activity_media')
      .select('activity_id, media_url, media_type, position, focal_x, focal_y, created_at')
      .in('activity_id', ids.slice(i, i + 150));
    media.push(...(rows ?? []));
  }
  const coverOf = new Map(activities.filter((a) => a.photo_url).map((a) => [a.id, a.photo_url]));
  // The cover is saved once, in photos/; the rest go in media/.
  const extra = media
    .filter((m) => m.media_url !== coverOf.get(m.activity_id))
    .sort((a, b) => (a.activity_id < b.activity_id ? -1 : a.activity_id > b.activity_id ? 1 : (a.position ?? 1e9) - (b.position ?? 1e9)));

  const jobs: { url: string; path: (ext: string) => string; video: boolean; entry?: any }[] = [
    ...[...coverOf].map(([id, url]) => ({ url, path: (ext: string) => `photos/${id}.${ext}`, video: false })),
  ];
  const listing: any[] = [];
  const perActivity = new Map<string, number>();
  for (const m of extra) {
    const n = (perActivity.get(m.activity_id) ?? 0) + 1;
    perActivity.set(m.activity_id, n);
    const entry: any = { activity_id: m.activity_id, type: m.media_type, position: m.position, focal_x: m.focal_x, focal_y: m.focal_y, file: null };
    listing.push(entry);
    jobs.push({ url: m.media_url, path: (ext: string) => `media/${m.activity_id}/${n}.${ext}`, video: m.media_type === 'video', entry });
  }

  let photos = 0;
  let videos = 0;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    try {
      const res = await fetch(job.url);
      if (res.ok) {
        const type = res.headers.get('content-type') || '';
        const ext = job.video
          ? (/quicktime/.test(type) ? 'mov' : /webm/.test(type) ? 'webm' : 'mp4')
          : (type.includes('png') ? 'png' : 'jpg');
        const path = job.path(ext);
        // Photos and videos are already compressed: stored, not re-compressed.
        files[path] = [new Uint8Array(await res.arrayBuffer()), { level: 0 }];
        if (job.entry) job.entry.file = path;
        if (job.video) videos++; else photos++;
      }
    } catch { /* a missing file never stops the archive */ }
    onProgress?.(i + 1, jobs.length);
  }
  files['media.json'] = strToU8(JSON.stringify(listing, null, 2));
  const zip = zipSync(files, { level: 6 });
  saveBlob(zip, `rival-archive-${new Date().toISOString().slice(0, 10)}.zip`, 'application/zip');
  return { activities: activities.length, photos, videos, routes: Object.keys(routes).length };
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
  /** item key → the activity's other photos and videos, in posting order. */
  extras: Map<string, ArchiveMedia[]>;
  /** item key → the cover's position, from a RIVAL archive. */
  coverFocal: Map<string, { x: number | null; y: number | null }>;
};

export type ArchiveMedia = { bytes: Uint8Array; ext: string; type: 'photo' | 'video'; focalX: number | null; focalY: number | null };

// Same as MediaPicker's MAX_VIDEO_MB (the bucket's per-file limit); not
// imported, so this file stays free of React Native for its tests.
const MAX_VIDEO_MB = 50;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;
const extOf = (name: string) => (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'jpg').toLowerCase();
function mimeOf(ext: string): string {
  if (ext === 'png') return 'image/png';
  if (ext === 'heic') return 'image/heic';
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'mp4' || ext === 'm4v') return 'video/mp4';
  return 'image/jpeg';
}

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
    filter: (f) => /(^|\/)(activities\.csv|data\.json|routes\.json|media\.json)$/.test(f.name)
      || /\.(gpx|gpx\.gz)$/i.test(f.name)
      || /\.(jpe?g|png|heic|mp4|mov|m4v|webm)$/i.test(f.name),
  });
  const find = (name: string) => Object.keys(entries).find((k) => k === name || k.endsWith(`/${name}`));
  const photos = new Map<string, { bytes: Uint8Array; ext: string }>();
  const extras = new Map<string, ArchiveMedia[]>();
  const coverFocal = new Map<string, { x: number | null; y: number | null }>();

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
      const found = media.map((m) => find(m.replace(/^\.?\//, ''))).filter(Boolean) as string[];
      // The first photo is the cover; everything else comes back with it.
      const photoEntry = found.find((f) => !VIDEO_EXT.test(f));
      if (photoEntry) photos.set(key, { bytes: entries[photoEntry], ext: /png$/i.test(photoEntry) ? 'png' : 'jpg' });
      const rest = found.filter((f) => f !== photoEntry).map((f) => ({
        bytes: entries[f], ext: extOf(f), type: (VIDEO_EXT.test(f) ? 'video' : 'photo') as 'photo' | 'video', focalX: null, focalY: null,
      }));
      if (rest.length) extras.set(key, rest);
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
    return { source: 'strava', items, photos, extras, coverFocal };
  }

  const dataName = find('data.json');
  if (dataName) {
    const data = JSON.parse(strFromU8(entries[dataName]));
    const routesName = find('routes.json');
    const routes: Record<string, string> = routesName ? JSON.parse(strFromU8(entries[routesName])) : {};
    // media.json: every photo and video besides the cover (archives from
    // 2026-10-24 on; older ones have covers only).
    const mediaName = find('media.json');
    const listing: any[] = mediaName ? JSON.parse(strFromU8(entries[mediaName])) : [];
    const byActivity = new Map<string, any[]>();
    for (const m of listing) {
      if (!m?.activity_id || !m.file) continue;
      const entry = find(m.file);
      if (!entry) continue;
      const list = byActivity.get(m.activity_id) ?? [];
      list.push({ bytes: entries[entry], ext: extOf(entry), type: m.type === 'video' ? 'video' : 'photo', focalX: m.focal_x ?? null, focalY: m.focal_y ?? null, position: m.position ?? 1e9 });
      byActivity.set(m.activity_id, list);
    }
    const items: ImportItem[] = [];
    for (const a of (data.activities ?? []) as any[]) {
      if (!a?.id || !a.started_at) continue;
      const key = `r${a.id}`;
      const photoEntry = Object.keys(entries).find((k) => k.includes(`photos/${a.id}.`));
      if (photoEntry) photos.set(key, { bytes: entries[photoEntry], ext: /png$/i.test(photoEntry) ? 'png' : 'jpg' });
      if (a.photo_focal_x != null || a.photo_focal_y != null) coverFocal.set(key, { x: a.photo_focal_x ?? null, y: a.photo_focal_y ?? null });
      const rest = byActivity.get(a.id);
      if (rest?.length) extras.set(key, rest.sort((x, y) => x.position - y.position).map(({ position, ...m }) => m));
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
    return { source: 'rival', items, photos, extras, coverFocal };
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
      // Capped like every other activity photo (lib/imageResize.ts).
      const type = photo.ext === 'png' ? 'image/png' : 'image/jpeg';
      const up = await fitPhoto({ blob: new Blob([photo.bytes as BlobPart], { type }), mimeType: type, ext: photo.ext });
      const path = `${userId}/import/${it.providerId}.${up.ext}`;
      const { error } = await supabase.storage.from('activity-photos')
        .upload(path, up.blob, { contentType: up.mimeType, upsert: true });
      if (!error) it.photoPath = path;
    }
    const { results } = await callImport({ items: batch });
    out.push(...(results ?? []));
    // Each new activity gets back the rest of its photos and videos, and
    // the cover's position. Linked or skipped ones already exist and are
    // left as they are.
    for (const r of (results ?? []) as ImportResult[]) {
      if (r.status !== 'imported' || !r.id) continue;
      const it = batch.find((b) => b.key === r.key);
      if (!it) continue;
      const focal = read.coverFocal.get(it.key);
      if (focal) await supabase.from('activities').update({ photo_focal_x: focal.x, photo_focal_y: focal.y }).eq('id', r.id);
      await attachExtras(userId, r.id, it.providerId, read.extras.get(it.key) ?? []);
    }
    onProgress?.(Math.min(items.length, i + 10));
  }
  return out;
}

// Uploads an imported activity's other photos and videos and records them
// after the cover, in order. A file that fails is skipped, never the import.
async function attachExtras(userId: string, activityId: string, providerId: string, extras: ArchiveMedia[]) {
  let position = 1;
  for (let n = 0; n < extras.length; n++) {
    const m = extras[n];
    const mime = mimeOf(m.ext);
    const blob = new Blob([m.bytes as BlobPart], { type: mime });
    // The same caps as adding them by hand (MediaPicker, imageResize).
    if (m.type === 'video' && blob.size > MAX_VIDEO_MB * 1024 * 1024) continue;
    const up = m.type === 'photo' ? await fitPhoto({ blob, mimeType: mime, ext: m.ext }) : { blob, mimeType: mime, ext: m.ext };
    const path = `${userId}/import/${providerId}-${n + 1}.${up.ext}`;
    const { error } = await supabase.storage.from('activity-photos').upload(path, up.blob, { contentType: up.mimeType, upsert: true });
    if (error) continue;
    const url = supabase.storage.from('activity-photos').getPublicUrl(path).data.publicUrl;
    const { error: rowErr } = await supabase.from('activity_media').insert({
      activity_id: activityId, media_url: url, media_type: m.type, position, focal_x: m.focalX, focal_y: m.focalY,
    });
    if (!rowErr) position++;
  }
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
