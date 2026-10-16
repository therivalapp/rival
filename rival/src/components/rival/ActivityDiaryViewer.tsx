import { formatActivityDistance, formatElevation } from '../../lib/units';
import { bandFit } from '../../lib/titleFit';
import { SkyBackdrop } from './SkyBackdrop';
import { defaultActivityName } from '../../lib/activityName';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, Image, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { confirmAction, notify } from '../../lib/notify';
import { formatDurationClock } from '../../lib/format';
import { RivalColors, RivalRadius, RivalSerifFamily, RivalButtonColors, RivalGhost } from '../../constants/rivalTheme';
import { RespectStar } from './RespectStar';
import { activityDisplayName } from '../../lib/yearReview';
import { RivalIcon, activityIconName } from './RivalIcon';
import { CoverImage } from './CoverImage';
import { RivalBackButton } from './RivalBackButton';
import { WebVideo } from './MediaPicker';
import { TrainingPartners } from './TrainingPartners';
import { BusyText } from './BusyText';
import { EffortBreakdownSheet } from './EffortBreakdownSheet';
import { DetailsBody, detailsSummary, hasDetails, useActivityDetails } from './ActivityDetails';
import { STACKED_BESTS, fastestRest, fastestTitle, type FastestBest } from '../../lib/bestEfforts';

// Full-screen, tap-through "diary" viewer for a single activity — the photo
// dominates (70% of the screen), stats overlay its bottom edge, and a
// scrollable footer below carries an editable name/location, the people who
// were on the session, and a free-length journal entry (backed by
// activities.notes). Ported 1:1 from
// the Activity Journal mockup iterated in Claude — see that file's CSS for
// the exact px/color values this mirrors.
export type DiaryActivity = {
  id: string;
  name: string | null;
  activity_type: string;
  started_at: string;
  utc_offset_seconds?: number | null;
  duration_seconds: number;
  distance_meters: number;
  elevation_meters: number | null;
  effort_score: number;
  photo_url: string | null;
  photo_focal_x: number | null;
  photo_focal_y: number | null;
  notes: string | null;
  location: string | null;
  companions: string | null;
  // Set when this row is the viewer's own copy of somebody else's session.
  // They did not record it, so they get the names but not the picker.
  shared_from_activity_id: string | null;
  pinned: boolean;
  race_id: string | null;
  isPb: boolean;
  /** The best this personal best beat (metres or seconds), and which it was. */
  pbPrev?: number | null;
  pbKind?: 'distance' | 'time';
  /** New fastest times this run set (5 km, 10 km...), longest first. */
  fastest?: FastestBest[] | null;
  /** The owner confirmed it is correct, so it scores in full (no cap). */
  effort_confirmed?: boolean;
};

// "Wed 7 Oct · 9:33 am" in the viewer's own format, like a diary entry's date.
function diaryStamp(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
}

function formatViewerDate(dateStr: string): string {
  const d = new Date(dateStr);
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  return `${weekday}, ${month} ${d.getDate()}`;
}

// Same rule as my-activities.tsx's own METERS_SPORTS — Swim/Rowing read in
// meters (100m/1500m splits, not fractional km), everything else in km.
const METERS_SPORTS = new Set(['Swim', 'Rowing']);
function formatDistance(meters: number, activityType?: string): string | null {
  if (!meters || meters < 100) return null;
  return formatActivityDistance(meters, activityType);
}

function dayKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Same trick RivalProgressBar uses for its gradient fill: web can express a
// real CSS linear-gradient via backgroundImage on a plain View (react-
// native-web passes it straight through to the DOM node); native has no
// equivalent without adding expo-linear-gradient, so it falls back to a
// flat color. Acceptable — this app runs primarily on web (see AGENTS.md).
function scrimStyle(direction: 'toTop' | 'toBottom', strength = 0.45): any {
  if (Platform.OS === 'web') {
    const angle = direction === 'toTop' ? '0deg' : '180deg';
    return { backgroundImage: `linear-gradient(${angle}, rgba(0,0,0,0) 0%, rgba(0,0,0,${strength}) 100%)` };
  }
  return { backgroundColor: `rgba(0,0,0,${strength * 0.6})` };
}

export function ActivityDiaryViewer({
  activities,
  startIndex,
  onClose,
  closeSignal,
  onUpdate,
  onUploadPhoto,
  onArrangeMedia,
  mediaById,
}: {
  activities: DiaryActivity[];
  startIndex: number;
  onClose: () => void;
  // Goes up by one each time the Activity tab is tapped again: closes the viewer.
  closeSignal?: number;
  onUpdate: (id: string, patch: Partial<DiaryActivity>) => void;
  // Reuses the same upload flow the old card grid exposed via a camera icon —
  // without this, activities without a photo would have no way to get one
  // attached from this screen at all.
  onUploadPhoto?: (activityId: string) => void;
  // Opens the ordering sheet on what is already posted, without adding.
  onArrangeMedia?: (activityId: string) => void;
  // Every photo and video attached to each activity (activity_media), in
  // posting order. Passed live rather than baked into `activities`, so media
  // added while the viewer is open appears in the carousel straight away.
  mediaById?: Record<string, { url: string; type: 'photo' | 'video' }[]>;
}) {
  const [index, setIndex] = useState(startIndex);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [breakdownFor, setBreakdownFor] = useState<DiaryActivity | null>(null);
  const [raceName, setRaceName] = useState<string | null>(null);
  const activity = activities[index];
  const insets = useSafeAreaInsets();
  // Mobile-only redesign of the header (back arrow instead of X, date moved to
  // the footer, dots instead of "1 of 1"). Desktop keeps its original header
  // untouched — same 760 breakpoint as my-activities.tsx.
  const { width: windowWidth } = useWindowDimensions();
  const wide = windowWidth >= 760;
  // Details folded under the numbers (Ricky, 2026-10-14); closed again for
  // each activity.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const details = useActivityDetails(wide ? null : activity?.id);
  useEffect(() => { setDetailsOpen(false); }, [activity?.id]);

  // Drag-down-to-dismiss, like a native modal sheet — only claimed from the
  // handle bar (not the whole photo/scroll area), so it doesn't fight the
  // left/right tap-to-advance zones or the footer's TextInputs.
  const dragY = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
      onPanResponderMove: (_e, g) => { if (g.dy > 0) dragY.setValue(g.dy); },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 110 || g.vy > 0.7) {
          Animated.timing(dragY, { toValue: 900, duration: 200, useNativeDriver: true }).start(() => onClose());
        } else {
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true, friction: 8, tension: 60 }).start();
        }
      },
    })
  ).current;

  // Local editable copies, written to Supabase only when "Save Changes" is
  // tapped (not autosaved per-keystroke) — an explicit Save/Discard pair
  // replaced the earlier autosave-on-every-keystroke behavior, which read as
  // ambiguous with no visible confirmation that an edit had actually landed.
  const [name, setName] = useState(activity?.name || '');
  const [location, setLocation] = useState(activity?.location || '');
  const [notes, setNotes] = useState(activity?.notes || '');
  const [dirty, setDirty] = useState(false);
  // Web <textarea>s don't auto-grow with content by default — without this,
  // the journal box got its own internal scrollbar once text overflowed its
  // fixed height instead of the whole page just scrolling further, which is
  // what everywhere else in this viewer does.
  const [journalHeight, setJournalHeight] = useState(22);
  const [saving, setSaving] = useState(false);
  // onContentSizeChange (used for the auto-grow-while-typing case below)
  // only fires from actual user input on web — it does NOT refire just
  // because the `value` prop changed programmatically. Switching to an
  // activity with pre-existing long notes was leaving journalHeight stuck
  // at the reset value, clipping the text instead of growing to fit it.
  // Measuring the real DOM node's scrollHeight after the value lands sidesteps
  // that entirely (scrollHeight reflects the full content regardless of the
  // element's own clipped/visible height).
  const journalRef = useRef<TextInput>(null);

  useEffect(() => {
    setName(activity?.name || '');
    setLocation(activity?.location || '');
    setNotes(activity?.notes || '');
    setDirty(false);
    setJournalHeight(22);
    if (Platform.OS === 'web') {
      requestAnimationFrame(() => {
        const node = journalRef.current as unknown as { scrollHeight?: number } | null;
        if (node && typeof node.scrollHeight === 'number') {
          setJournalHeight(Math.max(22, node.scrollHeight));
        }
      });
    }
  }, [activity?.id]);

  function edit(field: 'name' | 'location' | 'notes', value: string) {
    if (field === 'name') setName(value);
    else if (field === 'location') setLocation(value);
    else setNotes(value);
    setDirty(true);
  }

  async function saveChanges() {
    if (!activity || saving) return;
    setSaving(true);
    const patch: Record<string, unknown> = {
      name: name.trim() || defaultActivityName(activity.activity_type, new Date(activity.started_at)),
      location: location.trim() || null,
      notes: notes.trim() || null,
    };
    if (name.trim()) patch.name_locked = true;
    const { error } = await supabase.from('activities').update(patch).eq('id', activity.id);
    setSaving(false);
    if (error) return;
    onUpdate(activity.id, patch as Partial<DiaryActivity>);
    setDirty(false);
  }

  function discardChanges() {
    setName(activity?.name || '');
    setLocation(activity?.location || '');
    setNotes(activity?.notes || '');
    setDirty(false);
  }

  // The X still just closes — but with unsaved edits sitting in local state
  // that close would silently drop them, so confirm first rather than
  // requiring Save before you're allowed to leave.
  async function handleClose() {
    if (dirty && !(await confirmAction({ title: 'Discard unsaved changes?', confirmLabel: 'Discard', destructive: true }))) return;
    onClose();
  }
  const firstCloseSignal = useRef(closeSignal);
  useEffect(() => {
    if (closeSignal !== firstCloseSignal.current) handleClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeSignal]);

  async function togglePin() {
    if (!activity) return;
    const next = !activity.pinned;
    onUpdate(activity.id, { pinned: next });
    const { error } = await supabase.from('activities').update({ pinned: next }).eq('id', activity.id);
    if (error) {
      onUpdate(activity.id, { pinned: !next });   // put it back
      notify('The activity could not be pinned', error.message);
    }
  }

  // The cover first — it is the photo that was chosen and cropped — then the
  // rest in the order they were added. The cover is usually also in
  // activity_media, so it is de-duplicated rather than shown twice. An
  // activity whose photo arrived some other way (an import) has a cover and
  // no media rows, and still gets its one photo.
  function photosOf(a: DiaryActivity | undefined): { url: string; type: 'photo' | 'video' }[] {
    if (!a) return [];
    const extra = mediaById?.[a.id] ?? [];
    const all = a.photo_url ? [{ url: a.photo_url, type: 'photo' as const }, ...extra] : extra;
    const seen = new Set<string>();
    return all.filter((m) => (seen.has(m.url) ? false : (seen.add(m.url), true)));
  }

  // Taps (and swipes) step through this activity's photos first, then on to
  // the next activity — the way Instagram stories move through one person's
  // posts before the next person's. Stepping back into the previous activity
  // lands on its LAST photo, so going back and forth retraces the same path.
  function advance(dir: 1 | -1) {
    const photos = photosOf(activity);
    const at = Math.min(photoIdx, Math.max(0, photos.length - 1));
    if (dir === 1 && at < photos.length - 1) { setPhotoIdx(at + 1); return; }
    if (dir === -1 && at > 0) { setPhotoIdx(at - 1); return; }

    const next = index + dir;
    if (next < 0) return;
    if (next >= activities.length) { onClose(); return; }
    const nextPhoto = dir === 1 ? 0 : Math.max(0, photosOf(activities[next]).length - 1);
    if (wide) { setIndex(next); setPhotoIdx(nextPhoto); return; }
    // Phones: a new activity slides in from the side, so moving on to the
    // next activity reads differently from moving to the next photo, which
    // changes in place (Ricky, 2026-10-11).
    if (sliding.current) return;
    sliding.current = true;
    const native = Platform.OS !== 'web';
    Animated.timing(slideX, { toValue: -dir * windowWidth, duration: 160, useNativeDriver: native }).start(() => {
      setIndex(next);
      setPhotoIdx(nextPhoto);
      slideX.setValue(dir * windowWidth);
      Animated.timing(slideX, { toValue: 0, duration: 240, useNativeDriver: native }).start(() => { sliding.current = false; });
    });
  }
  const slideX = useRef(new Animated.Value(0)).current;
  const sliding = useRef(false);

  // Swiping across the photo does what tapping its edges does. The responder
  // is created once, so it reaches the current advance() through a ref
  // rather than the stale one it would otherwise close over.
  // A swipe that ends over a tap zone also fires that zone's tap on the web,
  // which moved two photos at once. Taps straight after a swipe are ignored
  // so each swipe moves exactly one (Ricky, 2026-10-11).
  const lastSwipeAt = useRef(0);
  const tapAdvance = (dir: 1 | -1) => { if (Date.now() - lastSwipeAt.current > 400) advance(dir); };
  const raceId = activities[index]?.race_id ?? null;
  useEffect(() => {
    setRaceName(null);
    if (!raceId) return;
    let live = true;
    supabase.from('races').select('name').eq('id', raceId).maybeSingle()
      .then(({ data }) => { if (live && data?.name) setRaceName(data.name); });
    return () => { live = false; };
  }, [raceId]);

  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  const swipe = useRef(
    PanResponder.create({
      // Capture only a clearly horizontal drag, so a plain tap still reaches
      // the tap zones and a vertical drag still scrolls the page.
      onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderRelease: (_e, g) => {
        if (Math.abs(g.dx) >= 40) lastSwipeAt.current = Date.now();
        if (g.dx <= -40) advanceRef.current(1);
        else if (g.dx >= 40) advanceRef.current(-1);
      },
    })
  ).current;

  const dayActivities = useMemo(() => {
    if (!activity) return [];
    const key = dayKey(activity.started_at);
    return activities.filter((a) => dayKey(a.started_at) === key);
  }, [activities, activity?.started_at]);
  const dayPosition = activity ? dayActivities.findIndex((a) => a.id === activity.id) + 1 : 0;

  if (!activity) return null;

  const photos = photosOf(activity);
  const shownPhotoIdx = Math.min(photoIdx, Math.max(0, photos.length - 1));
  const shown = photos[shownPhotoIdx] ?? null;
  // The saved crop was measured against the cover, so it only applies there.
  const isCover = shown !== null && shown.url === activity.photo_url;

  const badgeKind: 'pb' | 'race' | null = activity.isPb ? 'pb' : activity.race_id ? 'race' : null;
  const fastestTop = !activity.isPb && activity.fastest?.length ? activity.fastest[0] : null;
  const phonePb = !wide && (activity.isPb || !!fastestTop);
  // Races get the same treatment in red: a band naming the race and a fine
  // red line inside the screen (Ricky, 2026-10-14).
  const phoneRace = !wide && !!activity.race_id;
  const pbOnDistance = phonePb && activity.isPb && activity.pbKind === 'distance';
  const pbOnTime = phonePb && activity.isPb && activity.pbKind !== 'distance';
  const pbNoun = activityDisplayName(activity.activity_type).toLowerCase();
  const pbTitle = fastestTop ? fastestTitle(fastestTop) : activity.pbKind === 'distance' ? `Farthest ${pbNoun}` : `Longest ${pbNoun}`;
  const pbJoin = fastestTop ? ' · ' : ' · up from ';
  const pbFromText = fastestTop
    ? `${formatDurationClock(fastestTop.seconds)}, was ${formatDurationClock(fastestTop.prevSeconds)}`
    : activity.pbPrev
    ? (activity.pbKind === 'distance'
      ? formatDistance(activity.pbPrev, activity.activity_type) ?? null
      : formatDurationClock(activity.pbPrev))
    : null;
  const ringColor = badgeKind === 'pb' ? RivalColors.rankAnchors.unrivaled : badgeKind === 'race' ? '#ff5c5c' : 'transparent';
  const distance = formatDistance(activity.distance_meters, activity.activity_type);
  const duration = activity.duration_seconds > 0 ? formatDurationClock(activity.duration_seconds) : null;
  const elevation = (activity.elevation_meters || 0) > 0 ? `↑ ${formatElevation(activity.elevation_meters!)}` : null;

  // Where and who. On phones they sit in one card under the numbers, each
  // with its icon on the same line height; the owner can still add partners
  // here (Ricky, 2026-10-11).
  const whoAndWhere = (
    <>
      <View style={[styles.locationRow, !wide && styles.detailRow]}>
        <RivalIcon name="location" size={wide ? 12 : 14} color="rgba(255,255,255,0.5)" />
        <TextInput
          style={[styles.locationInput, !wide && styles.detailText]}
          value={location}
          onChangeText={(v) => edit('location', v)}
          placeholder="Add a location"
          placeholderTextColor="rgba(255,255,255,0.45)"
        />
      </View>
      <TrainingPartners
        activityId={activity.id}
        startedAt={activity.started_at}
        companions={activity.companions}
        readOnly={!!activity.shared_from_activity_id}
        hideWhenEmpty={!wide}
        avatars={!wide}
        onChanged={() => onUpdate(activity.id, {})}
      />
    </>
  );

  return (
    <Animated.View style={[styles.overlay, { transform: [{ translateY: dragY }] }]}>
      <EffortBreakdownSheet
        activity={breakdownFor ? { ...breakdownFor, canReview: !breakdownFor.shared_from_activity_id } : null}
        onClose={() => setBreakdownFor(null)}
        onConfirmed={(id, effort) => {
          onUpdate(id, { effort_score: effort, effort_confirmed: true });
          setBreakdownFor((cur) => (cur && cur.id === id ? { ...cur, effort_score: effort, effort_confirmed: true } : cur));
        }}
      />
      <View style={styles.dragHandleArea} {...panResponder.panHandlers}>
        <View style={styles.dragHandle} />
      </View>
      <Animated.View style={[styles.scroll, { transform: [{ translateX: slideX }] }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={[styles.photoArea, !wide && styles.photoAreaPhone]} {...swipe.panHandlers}>
          {/* Phones: one bar per photo across the top, like stories. They
              start again when the next activity begins (Ricky, 2026-10-11). */}
          {!wide && photos.length > 1 ? (
            <View style={[styles.storyBars, { top: insets.top + 4 }]} pointerEvents="none">
              {photos.map((m, i) => (
                <View key={m.url} style={[styles.storyBar, i <= shownPhotoIdx && styles.storyBarOn]} />
              ))}
            </View>
          ) : null}
          {shown?.type === 'video' ? (
            // Plays muted and loops, like an Instagram carousel video. No
            // controls: the tap zones over it still move between items.
            <WebVideo key={shown.url} uri={shown.url} style={styles.photo} />
          ) : shown ? (
            <CoverImage
              uri={shown.url}
              focalX={isCover ? activity.photo_focal_x : null}
              focalY={isCover ? activity.photo_focal_y : null}
              style={styles.photo}
            />
          ) : (
            <TouchableOpacity
              style={[styles.photoFallback, !wide && styles.photoFallbackPhone]}
              activeOpacity={0.85}
              disabled={!onUploadPhoto}
              onPress={() => onUploadPhoto?.(activity.id)}
            >
              {wide ? (
                <>
                  <View style={styles.addPhotoCircle}>
                    <RivalIcon name="addPhoto" size={26} color={RivalColors.accentText} />
                  </View>
                  <Text style={styles.addPhotoLabel}>Add Photo</Text>
                  <Text style={styles.addPhotoSub}>Activities with photos get seen and remembered</Text>
                </>
              ) : (
                // Phones: the feed card's no-photo look (Ricky, 2026-10-11) —
                // large and faint behind serif words: the camera on your own
                // activity, the activity's icon on someone else's.
                <>
                  {/* The sky for the hour it started (Ricky, 2026-10-14). */}
                  <SkyBackdrop startedAt={activity.started_at} utcOffsetSeconds={activity.utc_offset_seconds} />
                  <View style={styles.fallbackArt} pointerEvents="none">
                    <RivalIcon name={onUploadPhoto ? 'addPhoto' : activityIconName(activity.activity_type)} size={240} color="rgba(255,255,255,0.16)" />
                  </View>
                  <Text style={styles.fallbackTitle}>{onUploadPhoto ? 'Add a photo' : 'No photo this time, still counts.'}</Text>
                  {onUploadPhoto ? <Text style={styles.fallbackSub}>Activities with photos get seen and remembered.</Text> : null}
                </>
              )}
            </TouchableOpacity>
          )}

          {/* Top scrim + header — date left, pin/counter/close right. */}
          {/* Phones keep a photo clear of everything but the two buttons
              (Ricky, 2026-10-11): no scrims, no stats over it. */}
          {wide || !shown ? <View style={[styles.headerScrim, { height: 90 + insets.top }, scrimStyle('toTop')]} pointerEvents="none" /> : null}
          {wide ? (
            <View style={[styles.header, { top: insets.top + 12 }]}>
              <View>
                <Text style={styles.headerDate}>{formatViewerDate(activity.started_at)}</Text>
                {dirty && <Text style={styles.saveStatusText}>Unsaved changes</Text>}
              </View>
              <View style={styles.headerRight}>
                <TouchableOpacity style={styles.pinCorner} onPress={() => router.push(`/manual-entry?editId=${activity.id}`)}>
                  <RivalIcon name="edit" size={14} color={RivalColors.accentText} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.pinCorner} onPress={togglePin}>
                  <RivalIcon name={activity.pinned ? 'star' : 'starOutline'} size={15} color={RivalColors.accentText} />
                </TouchableOpacity>
                <View style={styles.counter}>
                  <Text style={styles.counterText}>{dayPosition} of {dayActivities.length}</Text>
                </View>
                <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
                  <RivalIcon name="close" size={14} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            // Back where every other screen puts it, top left. The X it
            // replaces meant the same thing in an unfamiliar place.
            <View style={[styles.header, { top: insets.top + (photos.length > 1 ? 20 : 12) }]}>
              <View style={styles.headerLeft}>
                <RivalBackButton onPress={handleClose} color="#fff" style={styles.backBtn} />
                {dirty && <Text style={styles.saveStatusText}>Unsaved changes</Text>}
              </View>
              <View style={styles.headerRight}>
                {/* The usual overflow menu rather than a pencil: it holds more
                    than editing, and three dots is what people look for. */}
                <View style={styles.menuWrap}>
                  <TouchableOpacity style={styles.headerBtn} onPress={() => setMenuOpen((v) => !v)}>
                    <RivalIcon name="moreHoriz" size={20} color="#fff" />
                  </TouchableOpacity>
                  {menuOpen && (
                    <>
                      <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={() => setMenuOpen(false)} />
                      <View style={styles.menu}>
                        {/* A small point up to the button, so the menu reads as
                            coming from it (Ricky, 2026-10-14). */}
                        <View style={styles.menuCaret} pointerEvents="none" />
                        <TouchableOpacity
                          style={styles.menuItem}
                          onPress={() => { setMenuOpen(false); router.push(`/manual-entry?editId=${activity.id}`); }}
                        >
                          <RivalIcon name="edit" size={16} color={RivalColors.onSurface} />
                          <Text style={styles.menuText}>Edit activity</Text>
                        </TouchableOpacity>
                        {onUploadPhoto ? (
                          <TouchableOpacity
                            style={styles.menuItem}
                            onPress={() => { setMenuOpen(false); onUploadPhoto(activity.id); }}
                          >
                            <RivalIcon name="addPhoto" size={16} color={RivalColors.onSurface} />
                            <Text style={styles.menuText}>Add photos or videos</Text>
                          </TouchableOpacity>
                        ) : null}
                        {onArrangeMedia && photos.length > 1 ? (
                          <TouchableOpacity
                            style={styles.menuItem}
                            onPress={() => { setMenuOpen(false); onArrangeMedia(activity.id); }}
                          >
                            <RivalIcon name="batch" size={16} color={RivalColors.onSurface} />
                            <Text style={styles.menuText}>Arrange photos</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </>
                  )}
                </View>
              </View>
            </View>
          )}

          {/* Bottom scrim + overlaid stats — 3 chips left, effort pill right. */}
          {wide ? <View style={[styles.photoBottomScrim, scrimStyle('toBottom')]} pointerEvents="none" /> : null}
          {/* Above the tap zones, so the Effort pill opens its breakdown;
              box-none leaves the rest of the strip to the tap zones. */}
          {wide ? <View style={[styles.photoStats, { zIndex: 3 }]} pointerEvents="box-none">
            <View style={styles.photoChips} pointerEvents="none">
              {duration && <View style={styles.photoChip}><Text style={styles.photoChipText}>{duration}</Text></View>}
              {distance && <View style={styles.photoChip}><Text style={styles.photoChipText}>{distance}</Text></View>}
              {elevation && <View style={styles.photoChip}><Text style={styles.photoChipText}>{elevation}</Text></View>}
            </View>
            <TouchableOpacity
              style={styles.photoEffort}
              onPress={() => setBreakdownFor(activity)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`${activity.effort_score} Effort. Show breakdown`}
            >
              <Text style={styles.photoEffortNum}>{activity.effort_score}</Text>
              <Text style={styles.photoEffortUnit}>Effort</Text>
            </TouchableOpacity>
          </View> : null}

          {/* Tap zones over the photo — left/right step through this
              activity's photos, then on through the continuous activity
              order, matching the row's own ordering. */}
          <TouchableOpacity style={[styles.tapArea, styles.tapAreaLeft]} activeOpacity={1} onPress={() => tapAdvance(-1)} />
          <TouchableOpacity style={[styles.tapArea, styles.tapAreaRight]} activeOpacity={1} onPress={() => tapAdvance(1)} />

          {/* Phones, layout C (Ricky, 2026-10-11): the photo melts into the
              page, and only the type and title rest on that fade at the
              very bottom, so the photo and the details read as one piece. */}
          {!wide ? (
            <>
              <View style={styles.photoMelt} pointerEvents="none" />
              <View style={styles.photoTitle} pointerEvents="box-none">
                {/* The date lives on the journal's diary line, not on the photo. */}
                <Text style={styles.typeKicker}>{activity.activity_type}</Text>
                {/* Option B (Ricky, 2026-10-14): the pin star sits beside the
                    title it belongs to, leaving only back and more on the photo. */}
                <View style={styles.titleRow}>
                  <TextInput
                    style={[styles.nameInput, styles.nameInputPhone, styles.titleRowInput]}
                    value={name}
                    onChangeText={(v) => edit('name', v)}
                    placeholder={defaultActivityName(activity.activity_type, new Date(activity.started_at))}
                    placeholderTextColor="rgba(255,255,255,0.5)"
                    maxLength={30}
                  />
                  <TouchableOpacity onPress={togglePin} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={activity.pinned ? 'Unpin activity' : 'Pin activity'}>
                    {/* Spins and shines when pinned, like Respect on the feed (Ricky, 2026-10-14). */}
                    <RespectStar on={!!activity.pinned} size={30} onColour="#ffc94d" onGradient={['#fff4d6', '#ffc94d']} offColour="rgba(255,255,255,0.85)" animate />
                  </TouchableOpacity>
                </View>
              </View>
            </>
          ) : null}
        </View>

        <View style={[styles.footer, !wide && styles.footerPhone]}>
          {/* The Add an activity pop-up's warm glow along the top edge. */}

          {/* Instagram-style dots directly under the photo, one per photo —
              shown even for a single photo, so every activity with a photo
              reads the same way and a second one is visibly an addition. */}
          {wide && photos.length > 0 && (
            <View style={styles.dots}>
              {photos.map((m, i) => (
                <View key={m.url} style={[styles.dot, i === shownPhotoIdx && styles.dotActive]} />
              ))}
            </View>
          )}
          {wide ? (
            <>
              <Text style={styles.typeKicker}>{activity.activity_type}</Text>
              <TextInput
                style={styles.nameInput}
                value={name}
                onChangeText={(v) => edit('name', v)}
                placeholder={defaultActivityName(activity.activity_type, new Date(activity.started_at))}
                placeholderTextColor="rgba(255,255,255,0.3)"
              />
              {/* Same fade-at-the-tips underline treatment as the Month calendar's
                  title, just tinted the journal card's cream/brown instead of the
                  orange accent. */}
              <View style={styles.nameUnderline} />
              {whoAndWhere}

              {/* Subtle warm dark panel (not the bright beige "input field" look
                  this replaced) with the label sitting inside it, top-left —
                  text reads as ink on a page, not as filled-out form UI. */}
              <View style={styles.journalPanel}>
                <Text style={styles.journalPanelLabel}>Journal</Text>
                <View style={styles.journalPanelRule} />
                <TextInput
                  ref={journalRef}
                  style={[styles.journalInput, { height: journalHeight }]}
                  value={notes}
                  onChangeText={(v) => edit('notes', v)}
                  onContentSizeChange={(e) => setJournalHeight(Math.max(22, e.nativeEvent.contentSize.height))}
                  placeholder="What made this one worth remembering?"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  multiline
                />
              </View>
            </>
          ) : (
            // Phones (Ricky, 2026-10-11): the photo full length as before, the
            // numbers straight under it with Effort among them, then the title,
            // then the journal as the most inviting thing on the page.
            <>
              {/* The pop-up sheets' look (GreySheet): their lifted grey with the
                  warm glow from the top edge (Ricky, 2026-10-11). */}
              <View style={[styles.statCard, styles.statCardPop, styles.statCardStack, phonePb && styles.statCardPb, phoneRace && styles.statCardRace]}>
                {phoneRace ? (
                  <View style={[styles.pbBand, styles.raceBand]}>
                    <RivalIcon name="flag" size={13} color={RivalColors.event} />
                    <Text style={[styles.pbBandText, bandFit(`Event · ${raceName ?? ''}`)]} numberOfLines={1}>
                      <Text style={styles.raceBandTitle}>Event</Text>
                      {raceName ? <Text style={styles.pbBandFrom}>{` · ${raceName}`}</Text> : null}
                    </Text>
                  </View>
                ) : null}
                {/* A personal best heads the numbers in a thin gold band, and
                    the figure that set it turns gold, in place of the frame
                    around the screen (Ricky, 2026-10-14, option B). */}
                {phonePb ? (
                  <View style={styles.pbBand}>
                    <RivalIcon name="trophy" size={13} color="#ffd27a" />
                    <Text style={[styles.pbBandText, bandFit(`${pbTitle}${pbJoin}${pbFromText ?? ''}`)]} numberOfLines={1}>
                      <Text style={styles.pbBandTitle}>{pbTitle}</Text>
                      {pbFromText ? <Text style={styles.pbBandFrom}>{`${pbJoin}${pbFromText}`}</Text> : null}
                    </Text>
                  </View>
                ) : null}
                {/* Several bests in one run stack under the first, as on the
                    feed (Ricky, 2026-10-14, option A). */}
                {phonePb && fastestTop && activity.fastest!.length > 1 ? (
                  <>
                    {activity.fastest!.slice(1, STACKED_BESTS).map((b) => (
                      <View key={b.meters} style={[styles.pbBand, styles.pbBandSub]}>
                        <Text style={[styles.pbBandText, { fontSize: bandFit(fastestTitle(b) + fastestRest(b)).fontSize - 1 }]} numberOfLines={1}>
                          <Text style={styles.pbBandTitle}>{fastestTitle(b)}</Text>
                          <Text style={styles.pbBandFrom}>{fastestRest(b)}</Text>
                        </Text>
                      </View>
                    ))}
                  </>
                ) : null}
                <View style={styles.statRow}>
                {duration ? <View style={styles.stat}><Text style={[styles.statLabel, pbOnTime && styles.statLabelBest]}>{pbOnTime ? 'Best' : 'Time'}</Text><Text style={[styles.statValue, pbOnTime && styles.statValueBest]}>{duration}</Text></View> : null}
                {distance ? <View style={[styles.stat, !!duration && styles.statDivided]}><Text style={[styles.statLabel, pbOnDistance && styles.statLabelBest]}>{pbOnDistance ? 'Best' : 'Distance'}</Text><Text style={[styles.statValue, pbOnDistance && styles.statValueBest]}>{distance}</Text></View> : null}
                {elevation ? <View style={[styles.stat, !!(duration || distance) && styles.statDivided]}><Text style={styles.statLabel}>Climb</Text><Text style={styles.statValue}>{elevation.replace('↑ ', '')}</Text></View> : null}
                <TouchableOpacity
                  style={[styles.stat, !!(duration || distance || elevation) && styles.statDivided]}
                  onPress={() => setBreakdownFor(activity)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`${activity.effort_score} Effort. Show breakdown`}
                >
                  <Text style={styles.statLabel}>Effort ›</Text>
                  <Text style={[styles.statValue, styles.statEffort, styles.statEffortBright]}>{activity.effort_score}</Text>
                </TouchableOpacity>
                </View>
              </View>

              {/* The finer details, folded: one quiet line until opened
                  (Ricky, 2026-10-14). */}
              {hasDetails(details) ? (
                <View style={styles.finerCard}>
                  <TouchableOpacity style={styles.detailsHead} onPress={() => setDetailsOpen((v) => !v)} activeOpacity={0.8} accessibilityRole="button" accessibilityState={{ expanded: detailsOpen }}>
                    <Text style={styles.detailsLabel}>Details</Text>
                    <RivalIcon name="chevronDown" size={18} color="rgba(255,255,255,0.5)" style={detailsOpen ? { transform: [{ rotate: '180deg' }] } : undefined} />
                  </TouchableOpacity>
                  {detailsOpen ? (
                    <View style={styles.detailsOpenBody}>
                      <DetailsBody details={details!} bests={activity.fastest} />
                      {details!.provider === 'strava' ? <Text style={styles.detailsAttribution}>Powered by Strava</Text> : null}
                    </View>
                  ) : detailsSummary(details) ? (
                    <Text style={styles.detailsSummary} numberOfLines={1}>{detailsSummary(details)}</Text>
                  ) : null}
                </View>
              ) : null}

              {/* The journal as a diary page: dated like an entry, with faint
                  writing lines while it is empty (Ricky, 2026-10-11). */}
              <TouchableOpacity style={styles.diary} activeOpacity={1} onPress={() => journalRef.current?.focus()}>
                <View style={styles.diaryHead}>
                  <Text style={styles.diaryLabel}>Journal</Text>
                  <Text style={styles.diaryDate}>{diaryStamp(activity.started_at)}</Text>
                </View>
                {/* While empty the prompt sits on the first ruled line, with two
                    more below, so it reads as writing on the page. */}
                <View>
                  <TextInput
                    ref={journalRef}
                    style={[styles.journalInput, styles.journalInputPhone, !notes && styles.journalPromptBold, { height: journalHeight }]}
                    value={notes}
                    onChangeText={(v) => edit('notes', v)}
                    onContentSizeChange={(e) => setJournalHeight(Math.max(26, e.nativeEvent.contentSize.height))}
                    placeholder="How did it go?"
                    placeholderTextColor="#fff"
                    multiline
                  />
                  {/* The lines are their own views, never padding or a border on the
                      input: on web a multiline input's measured height includes its
                      padding, so growing it fed back into its own size and looped. */}
                  {!notes.trim() ? (
                    <>
                      <View style={styles.diaryRuled} />
                      <View style={styles.diaryLine} />
                      <View style={styles.diaryLine} />
                    </>
                  ) : null}
                </View>
                {!notes.trim() ? <Text style={styles.diaryNote}>Shown with the activity on the team feed.</Text> : null}
              </TouchableOpacity>

              <View style={styles.detailsCard}>{whoAndWhere}</View>
            </>
          )}

          {dirty && (
            <View style={styles.saveRow}>
              <TouchableOpacity style={styles.discardBtn} onPress={discardChanges} disabled={saving}>
                <Text style={styles.discardBtnLabel}>Discard</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={saveChanges} disabled={saving}>
                <BusyText busy={!!(saving)} style={styles.saveBtnLabel}>{saving ? 'Saving…' : 'Save'}</BusyText>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
      </Animated.View>

      {/* Ring sits OUTSIDE the ScrollView so it never scrolls with content —
          same reasoning as the mockup's #viewerRing sibling element. A plain
          border works fine here (unlike the mockup's CSS, which needed an
          ::after overlay to dodge borders shrinking a shared padding box) —
          this ring has no children of its own, so there's no box to shrink. */}
      {/* Phones mark a personal best in the numbers instead (pbBand); a race keeps its ring. */}
      {badgeKind && wide && <View pointerEvents="none" style={[styles.ring, { borderColor: ringColor }]} />}
      {/* Plus a fine gold line, rounded inside the phone's own corners (Ricky, 2026-10-14). */}
      {(phonePb || phoneRace) && <View pointerEvents="none" style={[styles.pbEdge, phoneRace && styles.raceEdge]} />}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#0a0a0a', zIndex: 500 },
  dragHandleArea: { position: 'absolute', top: 0, left: 0, right: 0, height: 26, alignItems: 'center', justifyContent: 'center', zIndex: 6 },
  dragHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)' },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },

  photoArea: { height: '70%' as any, minHeight: 400, position: 'relative', overflow: 'hidden', backgroundColor: '#211c19' },
  photo: { width: '100%', height: '100%' },
  // Phones: 20% shorter than the 70% / 400 desktop hero (Ricky, 2026-10-11).
  photoAreaPhone: { height: '56%' as any, minHeight: 320 },
  nameInputPhone: { marginTop: 2, fontSize: 20, lineHeight: 26 },
  statEffort: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 22 },
  // A brighter run of the same faded gold: on the card's warm glow the usual
  // fade (#ffe6b0 to #f5b759) read dull and brownish (Ricky, 2026-10-11).
  statEffortBright: Platform.OS === 'web'
    ? ({ color: '#ffc94d', backgroundImage: 'linear-gradient(180deg, #fff4d6 0%, #ffc94d 100%)', backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' } as any)
    : { color: '#ffc94d' },
  statCard: {
    flexDirection: 'row', marginTop: 0, paddingVertical: 13,
    borderRadius: 16, borderWidth: 1, borderColor: RivalGhost.border, backgroundColor: RivalGhost.fill,
  },
  // Equal columns split by hairlines, so the figures fill the card evenly.
  statCardPop: {
    backgroundColor: RivalColors.surfaceBright, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden',
    ...(Platform.OS === 'web'
      ? { backgroundImage: 'radial-gradient(ellipse 80% 120% at 50% 0%, rgba(217,119,87,0.22) 0%, rgba(217,119,87,0.08) 45%, rgba(217,119,87,0) 100%)' } as any
      : {}),
  },
  stat: { flex: 1, gap: 3, alignItems: 'center' },
  statDivided: { borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.08)' },
  // Set 4px in from the edge with a slightly rounder curve than the screen's
  // own (~55), so the whole line sits inside the corners instead of being
  // clipped by them. No glow (Ricky, 2026-10-14).
  pbEdge: {
    position: 'absolute', top: 4, left: 4, right: 4, bottom: 4, zIndex: 50,
    borderRadius: 56, borderWidth: 1.5, borderColor: 'rgba(255,215,0,0.6)',
  },
  statCardStack: { flexDirection: 'column', paddingVertical: 0 },
  statCardPb: { borderColor: 'rgba(255,201,77,0.4)' },
  // Events in ivory, so red stays for delete (Ricky, 2026-10-16).
  statCardRace: { borderColor: 'rgba(244,234,216,0.35)' },
  raceEdge: { borderColor: 'rgba(244,234,216,0.6)' },
  raceBand: {
    borderBottomColor: 'rgba(244,234,216,0.16)',
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(90deg, rgba(244,234,216,0.12), rgba(244,234,216,0))' } as any : { backgroundColor: 'rgba(244,234,216,0.07)' }),
  },
  raceBandTitle: { fontWeight: '700', color: RivalColors.event },
  statRow: { flexDirection: 'row', paddingVertical: 13 },
  pbBand: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,201,77,0.18)',
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(90deg, rgba(255,201,77,0.13), rgba(255,201,77,0))' } as any : { backgroundColor: 'rgba(255,201,77,0.08)' }),
  },
  pbBandText: { flex: 1, fontSize: 12.5 },
  pbBandSub: {
    paddingVertical: 6, paddingLeft: 35,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(90deg, rgba(255,201,77,0.07), rgba(255,201,77,0))' } as any : { backgroundColor: 'rgba(255,201,77,0.04)' }),
  },
  finerCard: { marginTop: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border },
  detailsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailsLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' },
  detailsSummary: { marginTop: 7, fontSize: 13, color: 'rgba(255,255,255,0.85)' },
  detailsOpenBody: { marginTop: 12 },
  detailsAttribution: { marginTop: 14, textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.35)' },
  pbBandTitle: { fontWeight: '700', color: '#ffe6a8' },
  pbBandFrom: { fontWeight: '500', color: 'rgba(255,255,255,0.5)' },
  statLabelBest: { color: '#ffd27a' },
  statValueBest: Platform.OS === 'web'
    ? ({ color: '#ffc94d', backgroundImage: 'linear-gradient(180deg, #fff4d6 0%, #ffc94d 100%)', backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' } as any)
    : { color: '#ffc94d' },
  statLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.3, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' },
  statValue: { fontSize: 19, fontWeight: '700', color: '#fff' },
  detailsCard: { marginTop: 10, gap: 8, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border },
  detailRow: { marginTop: 0, gap: 8 },
  detailText: { fontSize: 14 },
  // While empty, the prompt is set bold like the title so it reads as clearly;
  // what you type is the regular weight.
  journalPromptBold: { fontWeight: '700' },
  journalInputPhone: { fontSize: 18, lineHeight: 26, color: '#fff' },
  diary: { marginTop: 16, gap: 10, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.055)' },
  diaryHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  diaryLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)' },
  diaryDate: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 12, color: 'rgba(255,255,255,0.5)' },
  // Ruled lines one text line apart: the prompt's own line, then two more.
  diaryRuled: { height: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  diaryLine: { height: 33, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  diaryNote: { fontSize: 11.5, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  // Phones: the Add an activity pop-up's neutral grey instead of brown.
  footerPhone: { backgroundColor: RivalColors.surfaceHigh, borderTopWidth: 0, paddingTop: 6, paddingBottom: 130 },
  photoMelt: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: '38%' as any, zIndex: 2,
    ...(Platform.OS === 'web'
      ? { backgroundImage: `linear-gradient(0deg, ${RivalColors.surfaceHigh} 0%, rgba(40,40,40,0.85) 30%, rgba(40,40,40,0) 100%)` } as any
      : { backgroundColor: 'rgba(40,40,40,0.5)' }),
  },
  photoTitle: { position: 'absolute', left: 20, right: 20, bottom: 2, zIndex: 4 },
  photoFallbackPhone: { backgroundColor: RivalColors.surfaceContainer },
  photoFallback: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: '#2d241f', gap: 4 },
  addPhotoCircle: { width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, borderColor: RivalColors.accentText, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  fallbackArt: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  fallbackFade: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    ...(Platform.OS === 'web' ? { backgroundImage: 'radial-gradient(ellipse 90% 60% at 50% 40%, rgba(255,209,190,0.10) 0%, rgba(19,19,19,0) 65%), linear-gradient(0deg, rgba(32,32,31,0.55), rgba(32,32,31,0) 65%)' } as any : {}),
  },
  fallbackTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 20, fontWeight: '700', color: '#fff', textAlign: 'center' },
  fallbackSub: { fontSize: 13, color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginTop: 4, maxWidth: 240 },
  addPhotoLabel: { fontSize: 15, fontWeight: '700', color: RivalColors.accentText },
  addPhotoSub: { fontSize: 12, fontWeight: '500', color: 'rgba(255,255,255,0.5)', marginTop: 2, maxWidth: 220, textAlign: 'center' },

  headerScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: 90 },
  // zIndex above `tapArea` below — tapArea renders after this in JSX and
  // would otherwise stack on top on web, swallowing taps on these buttons
  // (this was the cause of the close button appearing dead).
  header: { position: 'absolute', top: 18, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 5 },
  headerDate: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.92)' },
  saveStatusText: { fontSize: 10, fontWeight: '600', color: RivalColors.accentText, marginTop: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  menuWrap: { position: 'relative' },
  menuBackdrop: {
    position: Platform.OS === 'web' ? ('fixed' as any) : 'absolute',
    top: -2000, left: -2000, right: -2000, bottom: -2000,
  },
  menu: {
    position: 'absolute', top: 40, right: 0, minWidth: 200,
    borderRadius: 12, paddingVertical: 6, backgroundColor: '#2a221e',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    ...(Platform.OS === 'web' ? { boxShadow: '0px 8px 20px rgba(0,0,0,0.45)' } as any : {}),
  },
  menuCaret: {
    position: 'absolute', top: -6, right: 10, width: 12, height: 12,
    backgroundColor: '#2a221e', borderTopWidth: 1, borderLeftWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    transform: [{ rotate: '45deg' }],
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14 },
  menuText: { fontSize: 14, fontWeight: '600', color: RivalColors.onSurface },
  // Mobile header controls: one size and one fill, so the back arrow and the
  // edit/star pair read as a single set rather than two different components.
  // Smaller dark glass, so the buttons sit on the photo instead of greying it (Ricky, 2026-10-14).
  backBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.38)', borderWidth: 0, ...(Platform.OS === 'web' ? { backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' } as any : {}) },
  headerBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.38)', alignItems: 'center', justifyContent: 'center', ...(Platform.OS === 'web' ? { backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' } as any : {}) },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  titleRowInput: { flex: 1, minWidth: 0 },
  pinCorner: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.32)', alignItems: 'center', justifyContent: 'center' },
  counter: { backgroundColor: 'rgba(0,0,0,0.32)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  counterText: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
  closeBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.32)', alignItems: 'center', justifyContent: 'center' },

  photoBottomScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 110 },
  photoStats: { position: 'absolute', left: 16, right: 16, bottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  photoChips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  photoChip: { backgroundColor: 'rgba(0,0,0,0.4)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  photoChipText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.92)' },
  photoEffort: { flexDirection: 'row', alignItems: 'baseline', gap: 4, backgroundColor: 'rgba(0,0,0,0.4)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', borderRadius: 999, paddingLeft: 14, paddingRight: 12, paddingVertical: 5 },
  photoEffortNum: { fontSize: 15, fontWeight: '800', color: '#fff' },
  photoEffortUnit: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)' },

  tapArea: { position: 'absolute', top: 0, height: '100%', width: '42%' },
  tapAreaLeft: { left: 0 },
  tapAreaRight: { right: 0 },

  // Warm dark brown instead of the generic near-black surfaceLow — matches
  // the terracotta/brown palette the card grid and recap card already use.
  footer: { backgroundColor: '#1a1512', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', padding: 20, paddingBottom: 100, minHeight: '30%' as any },
  kickerDate: { color: 'rgba(255,255,255,0.5)', letterSpacing: 0.6 },
  storyBars: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', gap: 4, zIndex: 6 },
  storyBar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' },
  storyBarOn: { backgroundColor: '#fff' },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: -8, marginBottom: 14 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)' },
  dotActive: { backgroundColor: RivalColors.accentText },
  typeKicker: { fontSize: 13, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.accentText },
  nameInput: { marginTop: 3, padding: 0, fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 22, fontWeight: '700', color: '#fff', lineHeight: 28, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  // Solid at the left, fades out toward the right — a separate gradient bar
  // (plain borders can't fade), same pattern as the Month calendar's title.
  nameUnderline: {
    width: 150, height: 1.5, marginTop: 4, marginBottom: 2,
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(90deg, rgba(217,199,172,0.9) 0%, rgba(217,199,172,0.9) 40%, rgba(217,199,172,0) 100%)',
    } as any : { backgroundColor: 'rgba(217,199,172,0.9)' }),
  },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  locationInput: { flex: 1, padding: 0, fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.55)', ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },

  // Subtle warm dark panel, barely lifted off the footer's own background —
  // a bright beige fill read as a filled-out form input, competing with the
  // photo for attention. This is quieter: text reads as ink on a page.
  // Tighter padding than before — let the text (not empty dark space)
  // determine the block's height, so it reads as a reflection, not a component.
  journalPanel: { marginTop: 20, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 14, paddingVertical: 10 },
  // Negative marginLeft pulls the label past the panel's own horizontal
  // padding, flush with its true left edge (the journal body text below
  // keeps the normal padding).
  journalPanelLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.accentText },
  // Same solid-line treatment as the title's underline (nameUnderline) —
  // "carries that language" into the journal instead of a separate boxed
  // look, per feedback that the title's rule already does a lot of work.
  // Same solid-left-fades-right treatment as nameUnderline, tinted the
  // journal's accent orange instead of the title's cream/brown.
  journalPanelRule: {
    alignSelf: 'flex-start',
    width: 60, height: 1, marginTop: 6, marginBottom: 8,
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(90deg, rgba(217,119,87,0) 0%, rgba(217,119,87,0.6) 25%, rgba(217,119,87,0.6) 75%, rgba(217,119,87,0) 100%)',
    } as any : { backgroundColor: 'rgba(217,119,87,0.6)' }),
  },
  // outlineStyle suppresses the browser's default blue focus ring on web —
  // RNW passes this straight through to the underlying <textarea>'s CSS.
  journalInput: {
    padding: 0, backgroundColor: 'transparent',
    fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 16, lineHeight: 22, letterSpacing: 0.1,
    color: 'rgba(255,255,255,0.85)', minHeight: 22,
    // overflow:'hidden' — without this the underlying <textarea> falls back
    // to its own native scrollbar the instant content height and the
    // JS-driven `height` state are even momentarily out of sync (one
    // keystroke behind, since onContentSizeChange fires after the render).
    // The box should only ever grow; the outer page scrolls, not this box.
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },

  // Content-width pills (not flex:1 full-width) matching PhotoPositioner's
  // skip/confirm pair — the equal-split full-width version read as bulky
  // for what's ultimately a secondary confirmation, not a primary CTA.
  saveRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 24 },
  discardBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: RivalRadius.full, borderWidth: 1, borderColor: 'rgba(255,92,92,0.4)', alignItems: 'center' },
  discardBtnLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2, color: RivalColors.danger },
  saveBtn: { paddingVertical: 8, paddingHorizontal: 17, borderRadius: RivalRadius.full, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, alignItems: 'center' },
  saveBtnLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2, color: RivalButtonColors.label(RivalColors.onAccentFill) },

  ring: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 4 },
});
