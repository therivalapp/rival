import { createElement, useMemo, useState } from 'react';
import { Image, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RivalColors, RivalRadius, RivalGhost } from '../../constants/rivalTheme';
import { RivalIcon } from './RivalIcon';
import { confirmAction } from '../../lib/notify';
import { CoverImage } from './CoverImage';
import { GreySheet, GreyNote, GreyPrimary } from './RivalGreySheet';
import { sidePageWide } from '../../constants/breakpoints';

// Choosing photos and videos the way Instagram does: every item carries a
// number showing the order it will post in, the number follows the order you
// tap, and tapping one off renumbers the rest.
//
// On the web, RIVAL cannot read the camera roll — only the phone's own picker
// can — so this runs in two steps: the phone's picker first, then this sheet to
// set the order. On a native build the phone's picker numbers items itself
// (iOS 15+ `orderedSelection`), and this sheet still follows for the same
// arranging step.

// `blob` is set for something newly picked; `existingId` for something
// already saved on the activity (its activity_media id), so the picker can show
// the whole set and let it be reordered, not just what is being added.
export type MediaItem = {
  blob?: Blob;
  uri: string;
  type: 'photo' | 'video';
  mimeType: string;
  ext: string;
  existingId?: string;
};

// Shared by every screen that adds media, so an activity has one limit
// however its photos arrived. Instagram allows 20; this is lower on purpose —
// uploads are not yet compressed, and storage has already hit its quota once.
// Video is held at one per activity for the same reason: a single clip can
// weigh as much as a dozen photos.
export const MAX_MEDIA = 10;
export const MAX_VIDEOS = 1;
export const MAX_PHOTO_MB = 15;
// Must not exceed the activity-photos bucket's own file_size_limit (25MB).
// This was 50 while the bucket said 25, so a 30MB video passed the app's
// check and then failed at upload with a raw storage error.
export const MAX_VIDEO_MB = 25;
// A workout clip, not a documentary. Length is the real limit people meet;
// the size cap above is the storage backstop behind it.
export const MAX_VIDEO_SECONDS = 60;

export type PickResult = { items: MediaItem[]; rejected: string[] };

const TOO_LONG = `A video was over ${MAX_VIDEO_SECONDS / 60} minute and was left out`;

// Reads a video's length from its metadata without playing it. Null when the
// browser cannot tell — an unreadable length lets the video through rather
// than refusing something that may well be fine; the size cap still applies.
function webVideoSeconds(uri: string): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    const done = (n: number | null) => { clearTimeout(timer); v.removeAttribute('src'); v.load(); resolve(n); };
    const timer = setTimeout(() => done(null), 5000);
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => done(null);
    v.src = uri;
  });
}

function tooLarge(type: 'photo' | 'video', bytes: number): string | null {
  const mb = bytes / (1024 * 1024);
  if (type === 'video' && mb > MAX_VIDEO_MB) return `A video was over ${MAX_VIDEO_MB}MB and was left out`;
  if (type === 'photo' && mb > MAX_PHOTO_MB) return `A photo was over ${MAX_PHOTO_MB}MB and was left out`;
  return null;
}

// Opens the phone's own picker. Must be called straight from a tap — mobile
// browsers refuse to open a file picker that was not started by one, which is
// why this is a separate step rather than something the sheet does on mount.
export function pickMediaFiles(): Promise<PickResult> {
  if (Platform.OS !== 'web') return pickNative();
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.multiple = true;
    input.onchange = async () => {
      const rejected: string[] = [];
      const items: MediaItem[] = [];
      for (const file of Array.from(input.files || [])) {
        const type: 'photo' | 'video' = file.type.startsWith('video') ? 'video' : 'photo';
        const problem = tooLarge(type, file.size);
        if (problem) { rejected.push(problem); continue; }
        const uri = URL.createObjectURL(file);
        if (type === 'video') {
          const seconds = await webVideoSeconds(uri);
          if (seconds !== null && seconds > MAX_VIDEO_SECONDS + 0.5) {
            URL.revokeObjectURL(uri);
            rejected.push(TOO_LONG);
            continue;
          }
        }
        items.push({
          blob: file,
          uri,
          type,
          mimeType: file.type,
          ext: file.name.split('.').pop() || (type === 'video' ? 'mp4' : 'jpg'),
        });
      }
      resolve({ items, rejected });
    };
    // Closing the picker without choosing anything should settle too, where
    // the browser reports it.
    input.addEventListener('cancel', () => resolve({ items: [], rejected: [] }));
    input.click();
  });
}

async function pickNative(): Promise<PickResult> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { items: [], rejected: ['Photo library access is needed to add photos and videos'] };
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsMultipleSelection: true,
    orderedSelection: true,
    selectionLimit: MAX_MEDIA,
    quality: 0.8,
  });
  if (result.canceled || !result.assets?.length) return { items: [], rejected: [] };
  const rejected: string[] = [];
  const items: MediaItem[] = [];
  for (const asset of result.assets) {
    const type: 'photo' | 'video' = asset.type === 'video' ? 'video' : 'photo';
    // The native picker reports length in milliseconds.
    if (type === 'video' && asset.duration != null && asset.duration / 1000 > MAX_VIDEO_SECONDS + 0.5) {
      rejected.push(TOO_LONG);
      continue;
    }
    const blob = await (await fetch(asset.uri)).blob();
    const problem = tooLarge(type, blob.size);
    if (problem) { rejected.push(problem); continue; }
    items.push({
      blob,
      uri: asset.uri,
      type,
      mimeType: asset.mimeType || (type === 'video' ? 'video/mp4' : 'image/jpeg'),
      ext: asset.fileName?.split('.').pop() || (type === 'video' ? 'mp4' : 'jpg'),
    });
  }
  return { items, rejected };
}

// Web only: react-native has no video element, but react-native-web renders
// raw DOM elements, and an Instagram preview is a video that plays.
export function WebVideo({ uri, style }: { uri: string; style: object }) {
  if (Platform.OS !== 'web') {
    return (
      <View style={[style, styles.videoFallback]}>
        <RivalIcon name="video" size={28} color={RivalColors.accentText} />
      </View>
    );
  }
  return createElement('video', {
    src: uri,
    muted: true,
    autoPlay: true,
    loop: true,
    playsInline: true,
    style: { ...StyleSheet.flatten(style), objectFit: 'cover', display: 'block' },
  });
}

export function MediaPicker({
  initial,
  alreadyAttached = 0,
  videosAlreadyAttached = 0,
  initialNotice,
  title = 'New photos',
  doneLabel = 'Done',
  onCancel,
  onDone,
}: {
  // Starts selected, numbered in the order given.
  initial: MediaItem[];
  // Media already saved on the activity, which counts against the limit.
  alreadyAttached?: number;
  videosAlreadyAttached?: number;
  initialNotice?: string;
  title?: string;
  doneLabel?: string;
  onCancel: () => void;
  // The chosen items, in posting order.
  onDone: (items: MediaItem[]) => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const room = Math.max(0, MAX_MEDIA - alreadyAttached);
  const videoRoom = Math.max(0, MAX_VIDEOS - videosAlreadyAttached);

  const [pool, setPool] = useState<MediaItem[]>(initial);
  // Selection order, by uri. Position in this list IS the badge number.
  const [order, setOrder] = useState<string[]>(() => preselect(initial, room, videoRoom).order);
  const [focus, setFocus] = useState<string | null>(initial[0]?.uri ?? null);
  const [notice, setNotice] = useState<string | null>(
    initialNotice ?? preselect(initial, room, videoRoom).notice,
  );

  const byUri = useMemo(() => new Map(pool.map((m) => [m.uri, m])), [pool]);
  const selectedVideos = order.filter((u) => byUri.get(u)?.type === 'video').length;

  function toggle(item: MediaItem) {
    setNotice(null);
    setFocus(item.uri);
    if (order.includes(item.uri)) {
      // Instagram's rule: removing one closes the gap, so the numbers stay a
      // clean 1..n and always mean posting order.
      setOrder((prev) => prev.filter((u) => u !== item.uri));
      return;
    }
    if (order.length >= room) {
      setNotice(room === 0 ? `This activity already has ${MAX_MEDIA} photos and videos` : `Up to ${room} more can be added`);
      return;
    }
    if (item.type === 'video' && selectedVideos >= videoRoom) {
      setNotice(`One video per activity`);
      return;
    }
    setOrder((prev) => [...prev, item.uri]);
  }

  async function addMore() {
    const { items, rejected } = await pickMediaFiles();
    if (rejected.length) setNotice(rejected[0]);
    if (!items.length) return;
    setPool((prev) => [...prev, ...items]);
    // New arrivals join the end of the order, as far as there is room.
    // Worked out here rather than in a state updater, which React may run
    // twice — and which is no place for setting a notice.
    const next = [...order];
    let videos = order.filter((u) => byUri.get(u)?.type === 'video').length;
    let skipped: string | null = null;
    for (const item of items) {
      if (next.length >= room) { skipped = `Up to ${room} can be added`; break; }
      if (item.type === 'video') {
        if (videos >= videoRoom) { skipped = 'One video per activity'; continue; }
        videos++;
      }
      next.push(item.uri);
    }
    setOrder(next);
    if (skipped) setNotice(skipped);
    setFocus(items[0].uri);
  }

  // Unselecting something already saved means taking it off the activity.
  // That is the one thing here that cannot be undone, so it asks — once, for
  // all of them — rather than on each tap.
  async function finish() {
    const dropping = pool.filter((m) => m.existingId && !order.includes(m.uri)).length;
    if (dropping > 0) {
      const sure = await confirmAction({
        title: dropping === 1 ? 'Remove 1 item from this activity?' : `Remove ${dropping} items from this activity?`,
        message: 'Unselected items that were already posted will be deleted.',
        confirmLabel: 'Remove',
        destructive: true,
      });
      if (!sure) return;
    }
    onDone(order.map((u) => byUri.get(u)!).filter(Boolean));
  }

  const focused = focus ? byUri.get(focus) : undefined;
  const columns = 4;
  const gap = 2;
  // Sheet is full width on a phone; on anything wider it is a centred column,
  // so the grid is sized against that column rather than the window.
  const sheetWidth = Math.min(width, 520);
  const cell = Math.floor((sheetWidth - gap * (columns - 1)) / columns);

  const doneOff = order.length === 0 && !pool.some((m) => m.existingId);

  // Phone: the grey pop-up. Numbered thumbnails in posting order, Add more
  // as the last tile, Done pinned; tapping outside cancels.
  if (!sidePageWide(width)) {
    const pcols = 3;
    const pgap = 7;
    const pcell = Math.floor((width - 36 - pgap * (pcols - 1)) / pcols);
    return (
      <View style={[styles.overlay, pm.overlay]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onCancel} accessibilityLabel="Cancel" />
        <GreySheet
          kicker="PHOTOS"
          title={title}
          onClose={onCancel}
          footer={<GreyPrimary label={doneLabel} disabled={doneOff} onPress={finish} />}
        >
          <GreyNote>
            {order.length === 0 ? 'Tap photos in the order they should appear.' : `${order.length} selected, numbered in posting order. The first is the cover.`}
          </GreyNote>
          {notice ? <Text style={[styles.notice, { paddingHorizontal: 4, marginTop: 6 }]}>{notice}</Text> : null}
          <View style={[pm.grid, { gap: pgap }]}>
            {pool.map((item) => {
              const n = order.indexOf(item.uri) + 1;
              return (
                <TouchableOpacity key={item.uri} activeOpacity={0.85} onPress={() => toggle(item)} style={[pm.cell, { width: pcell, height: pcell }, n > 0 && pm.cellOn]}>
                  {item.type === 'video'
                    ? <WebVideo uri={item.uri} style={{ width: pcell, height: pcell }} />
                    : <Image source={{ uri: item.uri }} style={{ width: pcell, height: pcell }} />}
                  {item.type === 'video' ? (
                    <View style={styles.videoTag} pointerEvents="none"><RivalIcon name="video" size={13} color="#fff" /></View>
                  ) : null}
                  {n === 1 && item.type === 'photo' ? (
                    <View style={pm.cover} pointerEvents="none"><Text style={pm.coverText}>Cover</Text></View>
                  ) : null}
                  <View style={[styles.badge, n > 0 && styles.badgeOn]} pointerEvents="none">
                    {n > 0 ? <Text style={styles.badgeText}>{n}</Text> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={[pm.cell, pm.add, { width: pcell, height: pcell }]} onPress={addMore} activeOpacity={0.8}>
              <RivalIcon name="add" size={24} color={RivalColors.accentText} />
              <Text style={styles.addMoreText}>Add more</Text>
            </TouchableOpacity>
          </View>
        </GreySheet>
      </View>
    );
  }

  return (
    <View style={styles.overlay}>
      <View style={[styles.sheet, { width: sheetWidth, paddingTop: insets.top }]}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={onCancel} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <RivalIcon name="close" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>{title}</Text>
          <TouchableOpacity
            onPress={finish}
            // Empty is allowed only when it means removing what was posted.
            disabled={order.length === 0 && !pool.some((m) => m.existingId)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={[styles.done, order.length === 0 && !pool.some((m) => m.existingId) && styles.doneDisabled]}>{doneLabel}</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.preview, { height: sheetWidth }]}>
          {focused ? (
            focused.type === 'video'
              ? <WebVideo uri={focused.uri} style={styles.previewMedia} />
              : <CoverImage uri={focused.uri} style={styles.previewMedia} />
          ) : (
            <View style={styles.previewEmpty}>
              <Text style={styles.previewEmptyText}>Select a photo to preview</Text>
            </View>
          )}
        </View>

        <View style={styles.bar}>
          <Text style={styles.barText}>
            {order.length === 0 ? 'Select items in posting order' : `${order.length} selected · in posting order`}
          </Text>
        </View>
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        <ScrollView contentContainerStyle={[styles.grid, { gap, paddingBottom: insets.bottom + 24 }]}>
          {pool.map((item) => {
            const n = order.indexOf(item.uri) + 1;
            const isFocused = item.uri === focus;
            return (
              <TouchableOpacity
                key={item.uri}
                activeOpacity={0.85}
                onPress={() => toggle(item)}
                style={{ width: cell, height: cell }}
              >
                {item.type === 'video'
                  ? <WebVideo uri={item.uri} style={{ width: cell, height: cell }} />
                  : <Image source={{ uri: item.uri }} style={{ width: cell, height: cell }} />}
                {/* Instagram lightens the one you are looking at, so the grid
                    always shows which item the preview belongs to. */}
                {isFocused ? <View style={styles.focusWash} pointerEvents="none" /> : null}
                {item.type === 'video' ? (
                  <View style={styles.videoTag} pointerEvents="none">
                    <RivalIcon name="video" size={13} color="#fff" />
                  </View>
                ) : null}
                <View style={[styles.badge, n > 0 && styles.badgeOn]} pointerEvents="none">
                  {n > 0 ? <Text style={styles.badgeText}>{n}</Text> : null}
                </View>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity style={[styles.addMore, { width: cell, height: cell }]} onPress={addMore} activeOpacity={0.8}>
            <RivalIcon name="add" size={26} color={RivalColors.accentText} />
            <Text style={styles.addMoreText}>Add more</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </View>
  );
}

// Everything the phone's picker returned starts selected, in the order it
// came back — the person already chose these once, and making them tap each
// again would be the same choice twice. Anything over the limit arrives
// unselected, with a note saying why.
function preselect(items: MediaItem[], room: number, videoRoom: number): { order: string[]; notice: string | null } {
  const order: string[] = [];
  let videos = 0;
  let notice: string | null = null;
  for (const item of items) {
    if (order.length >= room) { notice = `Only ${room} can be added. Select to change which.`; break; }
    if (item.type === 'video') {
      if (videos >= videoRoom) { notice = 'One video per activity. The others are unselected.'; continue; }
      videos++;
    }
    order.push(item.uri);
  }
  return { order, notice };
}

const styles = StyleSheet.create({
  overlay: {
    position: Platform.OS === 'web' ? ('fixed' as any) : 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#000',
    zIndex: 900,
    alignItems: 'center',
  },
  sheet: { flex: 1, backgroundColor: '#0a0a0a' },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  title: { fontSize: 16, fontWeight: '700', color: '#fff' },
  done: { fontSize: 15, fontWeight: '700', color: RivalColors.accentText },
  doneDisabled: { opacity: 0.35 },

  preview: { width: '100%', backgroundColor: '#111' },
  previewMedia: { width: '100%', height: '100%' },
  previewEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  previewEmptyText: { color: 'rgba(255,255,255,0.45)', fontSize: 13 },

  bar: { paddingHorizontal: 16, paddingVertical: 10 },
  barText: { fontSize: 12.5, fontWeight: '600', color: 'rgba(255,255,255,0.7)' },
  notice: { fontSize: 12, color: RivalColors.accentText, paddingHorizontal: 16, paddingBottom: 8 },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  focusWash: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.35)' },
  videoTag: { position: 'absolute', left: 6, bottom: 6 },
  videoFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1512' },

  // Instagram's badge: an empty ring when not chosen, a filled circle with the
  // posting number when it is.
  badge: {
    position: 'absolute', top: 6, right: 6,
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 1.5, borderColor: '#fff',
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  badgeOn: { backgroundColor: RivalColors.accentFill, borderColor: RivalColors.accentFill },
  badgeText: { fontSize: 12, fontWeight: '800', color: RivalColors.onAccentFill },

  addMore: {
    alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: RivalRadius.sm,
  },
  addMoreText: { fontSize: 11.5, fontWeight: '600', color: RivalColors.accentText },
});

// Phone: the grey pop-up version.
const pm = StyleSheet.create({
  overlay: { backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end', alignItems: 'stretch' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  cell: { borderRadius: 12, overflow: 'hidden', backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border },
  cellOn: { borderColor: 'rgba(255,181,158,0.6)' },
  add: { alignItems: 'center', justifyContent: 'center', gap: 4, borderStyle: 'dashed', borderColor: 'rgba(255,181,158,0.35)' },
  cover: { position: 'absolute', left: 6, bottom: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.55)' },
  coverText: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.4, color: '#fff' },
});
