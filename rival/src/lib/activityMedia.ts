import { supabase } from './supabase';
import { fitPhoto } from './imageResize';
import type { MediaItem } from '../components/rival/MediaPicker';

// Saving an activity's photos and videos as one ordered set, Instagram-style:
// what you see numbered in the picker is exactly what the activity ends up
// with — same items, same order, and #1 (the first photo) is the cover.
//
// Shared by the Activity viewer and the add/edit screen so the two can never
// disagree about what "reorder" or "remove" means.

export type MediaRow = {
  id: string;
  activity_id: string;
  media_url: string;
  media_type: 'photo' | 'video';
  position: number | null;
  // Which part stays in view (media_focal.sql); null is the centre.
  focal_x: number | null;
  focal_y: number | null;
};

export const MEDIA_COLUMNS = 'id, activity_id, media_url, media_type, position, focal_x, focal_y';

// Marks an item that is the cover but has no activity_media row — a photo that
// arrived some other way. It is part of the set like any other; saving gives
// it a row so it can be ordered.
export const COVER_ONLY = 'cover-only';

// Order as saved, falling back to upload order for anything that predates
// positions. Used wherever media is read back, so it always matches the picker.
export function sortMedia<T extends { position: number | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));
}

// What the picker should start with for an activity that already has media:
// the cover first — it is the photo that was chosen as the face of the
// activity — then the rest in their saved order.
// The cover's position is the activity's own (photo_focal_x/y), which is
// what every card has always drawn it with.
export function existingAsItems(
  rows: MediaRow[],
  coverUrl: string | null,
  coverFocal?: { x: number | null; y: number | null },
): MediaItem[] {
  const ordered = sortMedia(rows);
  const items: MediaItem[] = ordered.map((r) => ({
    uri: r.media_url,
    type: r.media_type,
    mimeType: r.media_type === 'video' ? 'video/mp4' : 'image/jpeg',
    ext: '',
    existingId: r.id,
    focalX: r.focal_x,
    focalY: r.focal_y,
  }));
  if (coverUrl) {
    const at = items.findIndex((i) => i.uri === coverUrl);
    if (at > 0) items.unshift(...items.splice(at, 1));
    else if (at === -1) items.unshift({ uri: coverUrl, type: 'photo', mimeType: 'image/jpeg', ext: '', existingId: COVER_ONLY });
    if (coverFocal && (coverFocal.x != null || coverFocal.y != null)) {
      items[0] = { ...items[0], focalX: coverFocal.x, focalY: coverFocal.y };
    }
  }
  return items;
}

// Storage path from a public URL, so a removed photo's file goes too rather
// than sitting in the bucket forever — which is how storage hit its quota.
function storagePath(url: string): string | null {
  const marker = '/activity-photos/';
  const at = url.indexOf(marker);
  return at === -1 ? null : decodeURIComponent(url.slice(at + marker.length).split('?')[0]);
}

export type SaveResult = {
  rows: MediaRow[];
  cover: string | null;
  // The cover's position as saved on the activity.
  coverFocal: { x: number | null; y: number | null };
  coverChanged: boolean;
  errors: string[];
};

export async function saveArrangement({
  activityId,
  userId,
  items,
  existing,
  currentCover,
  keepCover = false,
  onProgress,
}: {
  activityId: string;
  userId: string;
  // The whole set, in posting order: existing items carry existingId, new
  // ones carry a blob.
  items: MediaItem[];
  // What the activity had before, so anything missing from `items` is known
  // to have been removed.
  existing: MediaRow[];
  currentCover: string | null;
  // Leave the cover alone and only add — for callers that append without
  // showing the whole set.
  keepCover?: boolean;
  // Called as each new file finishes uploading: (done, total).
  onProgress?: (done: number, total: number) => void;
}): Promise<SaveResult> {
  const errors: string[] = [];
  const keptIds = new Set(items.map((i) => i.existingId).filter(Boolean));

  // 1. Removed: anything the activity had that is no longer in the set.
  const removed = existing.filter((r) => !keptIds.has(r.id));
  if (removed.length) {
    const { error, count } = await supabase
      .from('activity_media')
      .delete({ count: 'exact' })
      .in('id', removed.map((r) => r.id));
    if (error) errors.push(`Couldn't remove: ${error.message}`);
    else if (count !== removed.length) errors.push("Some media couldn't be removed");
    else {
      const paths = removed.map((r) => storagePath(r.media_url)).filter(Boolean) as string[];
      if (paths.length) {
        // Housekeeping: the rows are already gone, so a failure here leaves
        // an orphaned file, not a broken activity.
        try { await supabase.storage.from('activity-photos').remove(paths); } catch { /* best effort */ }
      }
    }
  }

  // 2a. Upload every new file at once (Ricky, 2026-10-11: four photos one
  // after another took ~40 seconds). Only the files go in parallel; the rows
  // below are still written one at a time, in order, so a failure still lands
  // on a specific item and the posting order holds.
  const fresh = items.filter((i) => !i.existingId && i.blob);
  let uploaded = 0;
  onProgress?.(0, fresh.length);
  const uploads = new Map<MediaItem, Promise<{ url: string } | { error: string }>>();
  for (const item of fresh) {
    uploads.set(item, (async () => {
      const up = item.type === 'photo'
        ? await fitPhoto({ blob: item.blob!, mimeType: item.mimeType, ext: item.ext || 'jpg' })
        : { blob: item.blob!, mimeType: item.mimeType, ext: item.ext || 'mp4' };
      const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const path = `${userId}/${activityId}-${uniqueId}.${up.ext}`;
      const { error: storageErr } = await supabase.storage
        .from('activity-photos')
        .upload(path, up.blob, { contentType: up.mimeType, upsert: true });
      uploaded += 1;
      onProgress?.(uploaded, fresh.length);
      if (storageErr) return { error: `Upload failed: ${storageErr.message}` };
      return { url: supabase.storage.from('activity-photos').getPublicUrl(path).data.publicUrl };
    })());
  }

  // 2b. Every item, in order: record what is new, move what already exists.
  const rows: MediaRow[] = [];
  // Saved url → the picker item it came from, for the cover's position.
  const itemByUrl = new Map<string, MediaItem>();
  for (let position = 0; position < items.length; position++) {
    const item = items[position];

    if (item.existingId && item.existingId !== COVER_ONLY) {
      const before = existing.find((r) => r.id === item.existingId);
      const fx = item.focalX ?? null;
      const fy = item.focalY ?? null;
      if (before && (before.position !== position || before.focal_x !== fx || before.focal_y !== fy)) {
        const { error, count } = await supabase
          .from('activity_media')
          .update({ position, focal_x: fx, focal_y: fy }, { count: 'exact' })
          .eq('id', item.existingId);
        if (error || !count) errors.push("Couldn't save the new order");
      }
      if (before) { rows.push({ ...before, position, focal_x: fx, focal_y: fy }); itemByUrl.set(before.media_url, item); }
      continue;
    }

    let url = item.uri;
    if (!item.existingId) {
      const pending = uploads.get(item);
      if (!pending) continue;
      const res = await pending;
      if ('error' in res) { errors.push(res.error); continue; }
      url = res.url;
    }

    const { data, error } = await supabase
      .from('activity_media')
      .insert({ activity_id: activityId, media_url: url, media_type: item.type, position, focal_x: item.focalX ?? null, focal_y: item.focalY ?? null })
      .select(MEDIA_COLUMNS)
      .single();
    if (error || !data) { errors.push(`Couldn't save: ${error?.message ?? 'unknown error'}`); continue; }
    rows.push(data as MediaRow);
    itemByUrl.set((data as MediaRow).media_url, item);
  }

  // 3. The cover is the first photo — Instagram's rule, and what the numbers
  // promised. Videos cannot be a cover, so a video at #1 passes it to the
  // first photo after it.
  const firstPhoto = rows.find((r) => r.media_type === 'photo')?.media_url ?? null;
  const cover = keepCover && currentCover ? currentCover : firstPhoto;
  const coverChanged = cover !== currentCover;
  // The cover keeps the position its item was given in the picker.
  const coverItem = cover ? itemByUrl.get(cover) : undefined;
  const coverFocal = { x: coverItem?.focalX ?? null, y: coverItem?.focalY ?? null };
  if (!keepCover || !currentCover) {
    const { error } = await supabase
      .from('activities')
      .update({ photo_url: cover, photo_focal_x: coverFocal.x, photo_focal_y: coverFocal.y })
      .eq('id', activityId);
    if (error) errors.push(`Couldn't set the cover: ${error.message}`);
  }

  return { rows, cover, coverFocal, coverChanged, errors };
}
