import { useEffect, useMemo, useState } from 'react';
import { useScreenHeight } from '../../lib/keyboard';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Modal, useSheetMotion } from './RivalModal';
import { useSheetDrag } from './useSheetDrag';
import { RivalIcon, activityIconName } from './RivalIcon';
import { RivalAvatar } from './RivalAvatar';
import { CoverImage } from './CoverImage';
import { SkyBackdrop } from './SkyBackdrop';
import { RivalButtonColors, RivalColors, RivalGhost, RivalSerifFamily } from '../../constants/rivalTheme';
import { supabase } from '../../lib/supabase';
import { formatRaceName } from '../../lib/identity';
import { parseFinishTime } from '../../lib/celebration';
import { liveClock } from '../../lib/liveActivity';
import { tileLabel } from '../../lib/activityTypes';
import { distanceUnit, elevationUnit, formatSpeedOrPace, formatWeight, KM_PER_MILE, toDisplayDistance, toDisplayElevation } from '../../lib/units';
import { WOD_LABEL, type ActivityStats } from '../../lib/activityStats';
import {
  byDay, eventKind, halves, hyroxRows, ordinalSuffix, paceBars, placingCaption, raceEfforts, shownPlacings, transitionKey, transitionTimes,
  type BestEffort, type EventKind, type Placings, type Split,
} from '../../lib/eventPage';
import { PlacingsEditor } from './PlacingsEditor';
import { EventTimesSheet, type TimesSaved } from './EventTimesSheet';
import { router } from 'expo-router';
import { confirmAction, notify } from '../../lib/notify';
import { legDistance, legName } from '../../lib/eventLegs';
import { effortDistance, fastestBests, RUN_TYPES, type EffortRow } from '../../lib/bestEfforts';

import { EventShare } from './EventShare';
import type { EventShareFacts } from '../../lib/eventShare';
import { GradientText } from './GradientText';

// A one-day event opened from its card (Ricky, 2026-11-04,
// design/event-compare-v9.png): the photo with the event's name, the finish
// time with last time's finish beside it, the bar of how the time split, then
// each leg on a line from circle to circle, and the Respect it got.
// Since 2026-11-04 (design/event-placings-mockup.png) the page fits the event:
// a race (marathon) gets its halves, pace per km, fastest efforts and details;
// HYROX gets its runs, stations and Roxzone with a rank under each; an event
// over several days gets its days and each event's score and place. Every
// event can carry placings (races.placings) and shows its photos.

export type EventLeg = {
  id: string;
  activity_type: string;
  started_at: string;
  utc_offset_seconds?: number | null;
  duration_seconds: number | null;
  distance_meters: number | null;
  effort_score: number | null;
  photo_url?: string | null;
  photo_focal_x?: number | null;
  photo_focal_y?: number | null;
};

type Race = {
  id: string;
  user_id: string;
  name: string;
  race_type: string | null;
  race_date: string | null;
  location: string | null;
  distance_km: number | null;
  actual_finish_time: string | null;
  disciplines: { name?: string }[] | null;
  placings?: Placings | null;
  /** Seconds between each leg and the next (supabase/add_race_transitions.sql). */
  transitions?: (number | null)[] | null;
};

/** What the page reads beyond the card's own fields. */
type Detail = {
  id: string; name: string | null; splits: Split[] | null; best_efforts: BestEffort[] | null; stats: ActivityStats | null;
  avg_heartrate: number | null; max_heartrate: number | null; avg_cadence: number | null; calories: number | null;
  elevation_meters: number | null; exercises: { name?: string; weight?: number | null; reps?: number | null }[] | null;
};
type Photo = { activityId: string; url: string; focalX: number; focalY: number };

type Last = { seconds: number; year: string } | null;
type Respect = { count: number; /** How many people gave it. */ from: number; people: { id: string; name: string; avatar: string | null }[] };

const PB_GOLD = RivalColors.rankAnchors.unrivaled;
// Ivory to light peach to salmon. Never the deep coral: on results it reads
// as red, as if something went wrong (Ricky, 2026-11-04).
const BAR = [RivalColors.event, '#ffd2bf', RivalColors.accentText];
const web = Platform.OS === 'web';

// The same event in another year: "T100 Wellington 2025" and "t100 wellington" match.
const sameEvent = (name: string) => name.toLowerCase().replace(/\b(19|20)\d{2}\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function EventSheet({ raceId, legs, pbLegIds, onClose, onOpenLeg, startShare, onEditDetails, onChanged }: {
  raceId: string | null;
  /** The event's activities on its one day. */
  legs: EventLeg[];
  /** Legs that set a personal best, for their own PB pill. */
  pbLegIds: Set<string>;
  onClose: () => void;
  onOpenLeg?: (id: string) => void;
  /** Open with the share pop-up up, from a Share button elsewhere. */
  startShare?: boolean;
  /** Edit event details from the menu; without it the Events page opens with the event's form. */
  onEditDetails?: (raceId: string) => void;
  /** After times change, so the page that opened it can reload. */
  onChanged?: () => void;
}) {
  return (
    <Modal visible={!!raceId} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} accessibilityLabel="Close" />
        {raceId ? <Sheet raceId={raceId} legs={legs} pbLegIds={pbLegIds} onClose={onClose} onOpenLeg={onOpenLeg} startShare={startShare} onEditDetails={onEditDetails} onChanged={onChanged} /> : null}
      </View>
    </Modal>
  );
}

const dayOf = (iso: string) => new Date(iso).toDateString();
const shortDay = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, o);

/** Pace for a km in the member's units: "4:45" and "/km". */
function paceText(secPerKm: number): { num: string; unit: string } {
  const mi = distanceUnit() === 'mi';
  const secs = Math.round(mi ? secPerKm * KM_PER_MILE : secPerKm);
  return { num: liveClock(secs), unit: mi ? '/mi' : '/km' };
}

/** The tag on the photo: what kind of event it is. */
function eventTag(race: Race | null, kind: EventKind, legs: EventLeg[]): string {
  if (kind === 'hyrox') return 'HYROX';
  if (kind === 'race') {
    const km = (legs[0]?.distance_meters ?? 0) / 1000;
    if (legs[0]?.activity_type?.includes('Run')) {
      if (km > 41.8 && km < 43) return 'Marathon';
      if (km > 20.8 && km < 21.6) return 'Half marathon';
    }
  }
  const t = race?.race_type;
  return t && ['Triathlon', 'HYROX', 'CrossFit'].includes(t) ? t : 'Event';
}

function Sheet({ raceId, legs: given, pbLegIds, onClose, onOpenLeg, startShare, onEditDetails, onChanged }: {
  raceId: string; legs: EventLeg[]; pbLegIds: Set<string>; onClose: () => void; onOpenLeg?: (id: string) => void; startShare?: boolean;
  onEditDetails?: (raceId: string) => void; onChanged?: () => void;
}) {
  // Leg times changed in Edit times show at once.
  const [legEdits, setLegEdits] = useState<TimesSaved['legs']>({});
  const unsorted = useMemo(() => given.map((a) => (legEdits[a.id] ? { ...a, ...legEdits[a.id] } : a)), [given, legEdits]);
  const [times, setTimes] = useState<'edit' | 'finish' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const height = useScreenHeight();
  const motion = useSheetMotion();
  const dragRef = useSheetDrag(onClose);
  const legs = useMemo(() => [...unsorted].sort((x, y) => x.started_at.localeCompare(y.started_at)), [unsorted]);
  const [race, setRace] = useState<Race | null>(null);
  const [last, setLast] = useState<Last | undefined>(undefined);
  const [respect, setRespect] = useState<Respect | null>(null);
  const [detail, setDetail] = useState<Record<string, Detail>>({});
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(!!startShare);

  useEffect(() => {
    let live = true;
    supabase.auth.getUser().then(({ data }) => { if (live) setMe(data.user?.id ?? null); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      // placings arrives with supabase/add_race_placings.sql; until it is run
      // the page reads the race without it.
      const cols = 'id, user_id, name, race_type, race_date, location, distance_km, actual_finish_time, disciplines';
      // transitions arrives with supabase/add_race_transitions.sql.
      let { data, error } = await supabase.from('races').select(`${cols}, placings, transitions`).eq('id', raceId).maybeSingle();
      if (error) ({ data, error } = await supabase.from('races').select(`${cols}, placings`).eq('id', raceId).maybeSingle());
      if (error) ({ data } = await supabase.from('races').select(cols).eq('id', raceId).maybeSingle());
      if (!live || !data) return;
      const r = data as Race;
      setRace(r);
      // Last time: the most recent earlier event of the same name.
      const day = r.race_date ?? legs[0]?.started_at.slice(0, 10);
      const { data: earlier } = day
        ? await supabase.from('races').select('id, name, race_date, actual_finish_time').eq('user_id', r.user_id).lt('race_date', day).order('race_date', { ascending: false })
        : { data: [] };
      const prev = ((earlier ?? []) as { id: string; name: string; race_date: string; actual_finish_time: string | null }[])
        .find((p) => sameEvent(p.name) === sameEvent(r.name));
      let lastTime: Last = null;
      if (prev) {
        let secs = parseFinishTime(prev.actual_finish_time);
        if (secs == null) {
          const { data: prevLegs } = await supabase.from('activities').select('duration_seconds').eq('race_id', prev.id);
          const sum = (prevLegs ?? []).reduce((t: number, a: { duration_seconds: number | null }) => t + (a.duration_seconds || 0), 0);
          secs = sum > 0 ? sum : null;
        }
        if (secs != null) lastTime = { seconds: secs, year: prev.race_date.slice(0, 4) };
      }
      if (live) setLast(lastTime);
    })();
    return () => { live = false; };
  }, [raceId, legs]);

  useEffect(() => {
    let live = true;
    (async () => {
      const ids = legs.map((a) => a.id);
      if (!ids.length) return;
      const [rows, media] = await Promise.all([
        supabase.from('activities')
          .select('id, name, splits, best_efforts, stats, avg_heartrate, max_heartrate, avg_cadence, calories, elevation_meters, exercises')
          .in('id', ids),
        supabase.from('activity_media').select('activity_id, media_url, media_type, position, focal_x, focal_y').in('activity_id', ids).order('position'),
      ]);
      if (!live) return;
      setDetail(Object.fromEntries(((rows.data ?? []) as Detail[]).map((d) => [d.id, d])));
      // Every photo from the event's activities, in the order they happened;
      // an activity without media rows still has its cover photo.
      const all: Photo[] = [];
      const m = (media.data ?? []) as { activity_id: string; media_url: string; media_type: string; focal_x: number | null; focal_y: number | null }[];
      for (const a of legs) {
        const mine = m.filter((x) => x.activity_id === a.id && x.media_type !== 'video');
        if (mine.length) mine.forEach((x) => all.push({ activityId: a.id, url: x.media_url, focalX: x.focal_x ?? 0.5, focalY: x.focal_y ?? 0.4 }));
        else if (a.photo_url) all.push({ activityId: a.id, url: a.photo_url, focalX: a.photo_focal_x ?? 0.5, focalY: a.photo_focal_y ?? 0.4 });
      }
      setPhotos(all);
    })();
    return () => { live = false; };
  }, [legs]);

  useEffect(() => {
    let live = true;
    (async () => {
      const ids = legs.map((a) => a.id);
      const [onRace, onLegs] = await Promise.all([
        supabase.from('feed_reactions').select('user_id').eq('target_type', 'race').eq('target_id', raceId).eq('emoji', 'respect'),
        ids.length ? supabase.from('feed_reactions').select('user_id').eq('target_type', 'activity').in('target_id', ids).eq('emoji', 'respect') : Promise.resolve({ data: [] }),
      ]);
      const rows = [...(onRace.data ?? []), ...(onLegs.data ?? [])] as { user_id: string }[];
      const userIds = [...new Set(rows.map((r) => r.user_id))];
      let people: Respect['people'] = [];
      if (userIds.length) {
        const { data } = await supabase.from('users').select('id, display_name, avatar_url').in('id', userIds.slice(0, 4));
        people = ((data ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[])
          .map((u) => ({ id: u.id, name: u.display_name ?? '', avatar: u.avatar_url }));
      }
      if (live) setRespect({ count: rows.length, from: userIds.length, people });
    })();
    return () => { live = false; };
  }, [raceId, legs]);

  const withStats = legs.map((a) => ({ ...a, stats: detail[a.id]?.stats ?? null }));
  const kind = eventKind(race?.race_type, withStats, dayOf);
  const days = kind === 'days' ? byDay(withStats, dayOf) : [];
  const legSecs = legs.reduce((t, a) => t + (a.duration_seconds || 0), 0);
  const official = parseFinishTime(race?.actual_finish_time);
  const finish = official ?? legSecs;
  // T1, T2: shown between the legs once known (design/event-transitions-mockup.png).
  const gapCount = kind === 'legs' ? Math.max(0, legs.length - 1) : 0;
  const trans = transitionTimes(race?.transitions, gapCount, official, legSecs);
  const beat = !!last && finish > 0 && finish < last.seconds;
  const cover = legs.find((a) => a.photo_url);
  const tag = eventTag(race, kind, legs);
  const dateIso = race?.race_date ?? legs[0]?.started_at;
  const when = kind === 'days' && legs.length
    ? `${shortDay(legs[0].started_at, { weekday: 'short', month: 'short', day: 'numeric' })} – ${shortDay(legs[legs.length - 1].started_at, { weekday: 'short', month: 'short', day: 'numeric' })}`
    : dateIso ? shortDay(dateIso, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  const total = kind === 'hyrox'
    ? '8 km + 8 stations'
    : race?.distance_km ? `${Math.round(toDisplayDistance(race.distance_km) * 10) / 10} ${distanceUnit()}` : null;
  const meta = [when, race?.location, total].filter(Boolean).join(' · ');
  const showSplitLabels = legs.length <= 3;
  const own = !!race && !!me && race.user_id === me;

  // An activity linked to the wrong event (a 10 km run on half marathon
  // day): undo the link. The activities and the event both stay (Ricky,
  // 2026-11-12).
  async function unlinkLegs() {
    const one = legs.length === 1;
    const ok = await confirmAction({
      title: one ? 'Remove the activity from this event?' : 'Remove the activities from this event?',
      message: one ? 'The activity stays in Activity. The event stays in Events.' : 'The activities stay in Activity. The event stays in Events.',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    const { error } = await supabase.from('activities').update({ race_id: null }).in('id', legs.map((l) => l.id)).eq('user_id', me!);
    if (error) { notify('The event link could not be removed', error.message); return; }
    onChanged?.();
    onClose();
  }
  const placings = shownPlacings(race?.placings);
  const parts = race?.placings?.parts ?? {};
  const one = legs[0];
  const oneDetail = one ? detail[one.id] : undefined;
  const hyroxStats = kind === 'hyrox' ? oneDetail?.stats : null;
  const division = hyroxStats?.wod?.division
    ?? (kind === 'days' ? race?.placings?.rows?.find((r) => r.key === 'division')?.category : null);

  // What the share can show (lib/eventShare.ts).
  const shareFacts: EventShareFacts = (() => {
    const hx = kind === 'hyrox' ? hyroxRows(hyroxStats?.laps, !!hyroxStats?.wod?.roxzone) : [];
    const dayLegs = days.flatMap((d) => d.legs);
    const best = dayLegs.map((a) => parts[a.id]).filter((n): n is number => !!n);
    const km = (one?.distance_meters ?? 0) / 1000;
    return {
      kind,
      finishSeconds: kind === 'days' ? 0 : finish,
      placings,
      hyrox: hx.length ? {
        running: hx.reduce((t, r) => t + (r.run ?? 0), 0),
        stations: hx.reduce((t, r) => t + (r.time ?? 0), 0),
        roxzone: hx.reduce((t, r) => t + (r.rox ?? 0), 0),
      } : null,
      days: kind === 'days' ? { count: days.length, events: dayLegs.length, worked: legSecs, bestPlace: best.length ? Math.min(...best) : null } : null,
      distance: kind === 'race' && km > 0 ? { value: String(Math.round(toDisplayDistance(km) * 10) / 10), unit: distanceUnit() } : null,
      pace: kind === 'race' && km > 0 && one?.duration_seconds ? (() => { const p = paceText(one.duration_seconds! / km); return { value: p.num, unit: p.unit }; })() : null,
      elevation: kind === 'race' && oneDetail?.elevation_meters ? { value: Math.round(toDisplayElevation(oneDetail.elevation_meters)).toLocaleString(), unit: elevationUnit() } : null,
    };
  })();
  const shareSub = kind === 'days' && legs.length
    ? `${shortDay(legs[0].started_at, { weekday: 'short', day: 'numeric' })} – ${shortDay(legs[legs.length - 1].started_at, { weekday: 'short', day: 'numeric', month: 'short' })} · ${legs.length} ${legs.length === 1 ? 'event' : 'events'}`
    : null;
  const totalEffort = legs.reduce((t, a) => t + (Number(a.effort_score) || 0), 0);
  const sharePhoto = photos[0] ?? (cover?.photo_url ? { activityId: cover.id, url: cover.photo_url, focalX: cover.photo_focal_x ?? 0.5, focalY: cover.photo_focal_y ?? 0.4 } : null);

  if (times && race) {
    return (
      <EventTimesSheet
        mode={times}
        race={race}
        legs={legs}
        transitionGaps={gapCount}
        showFinish={kind !== 'days'}
        onClose={() => setTimes(null)}
        onSaved={(saved) => {
          setRace({ ...race, actual_finish_time: saved.actual_finish_time, ...(gapCount ? { transitions: saved.transitions } : {}) });
          setLegEdits((cur) => ({ ...cur, ...saved.legs }));
          setTimes(null);
          onChanged?.();
        }}
      />
    );
  }

  if (editing && race) {
    return (
      <PlacingsEditor
        raceId={race.id}
        eventName={formatRaceName(race.name)}
        initial={race.placings ?? null}
        kind={kind === 'hyrox' ? 'hyrox' : kind === 'days' ? 'days' : 'other'}
        events={days.flatMap((d) => d.legs).map((a, i) => ({ id: a.id, name: detail[a.id]?.name || `Event ${i + 1}` }))}
        onBack={() => setEditing(false)}
        onSaved={(p) => { setRace({ ...race, placings: p }); setEditing(false); }}
      />
    );
  }

  return (
    <View ref={dragRef as any} style={[s.sheet, motion, { maxHeight: height * 0.92 }]}>
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.hero}>
          {cover?.photo_url ? (
            <CoverImage uri={cover.photo_url} focalX={cover.photo_focal_x ?? 0.5} focalY={cover.photo_focal_y ?? 0.35} style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, s.heroArt]}>
              <SkyBackdrop startedAt={legs[0]?.started_at} utcOffsetSeconds={legs[0]?.utc_offset_seconds} />
              <RivalIcon name="flag" size={88} color="rgba(255,255,255,0.14)" />
            </View>
          )}
          <View style={[s.heroShade, { pointerEvents: 'none' }]} />
          <View style={s.grabber} />
          {/* Your own event: its edits sit in the menu, top right, as on an
              activity (Ricky, 2026-11-05). */}
          {own && race ? (
            <View style={s.menuWrap}>
              <TouchableOpacity style={s.moreBtn} onPress={() => setMenuOpen((v) => !v)} accessibilityRole="button" accessibilityLabel="More">
                <RivalIcon name="moreHoriz" size={20} color="#fff" />
              </TouchableOpacity>
              {menuOpen ? (
                <>
                  <TouchableOpacity style={s.menuBackdrop} activeOpacity={1} onPress={() => setMenuOpen(false)} accessibilityLabel="Close menu" />
                  <View style={[s.menu, web ? ({ animationName: 'rivalMenuIn', animationDuration: '160ms', animationTimingFunction: 'ease-out' } as any) : null]}>
                    <View style={[s.menuCaret, { pointerEvents: 'none' }]} />
                    <TouchableOpacity style={s.menuItem} onPress={() => { setMenuOpen(false); setTimes('edit'); }} accessibilityRole="button">
                      <RivalIcon name="timer" size={16} color={RivalColors.onSurface} />
                      <Text style={s.menuText}>Edit times</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.menuItem}
                      onPress={() => {
                        setMenuOpen(false);
                        onClose();
                        if (onEditDetails) onEditDetails(race.id);
                        else router.push(`/races?edit=${race.id}`);
                      }}
                      accessibilityRole="button"
                    >
                      <RivalIcon name="calendar" size={16} color={RivalColors.onSurface} />
                      <Text style={s.menuText}>Edit event details</Text>
                    </TouchableOpacity>
                    {legs.length ? (
                      <TouchableOpacity style={s.menuItem} onPress={() => { setMenuOpen(false); unlinkLegs(); }} accessibilityRole="button">
                        <RivalIcon name="close" size={16} color={RivalColors.onSurface} />
                        <Text style={s.menuText}>Remove from event</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </>
              ) : null}
            </View>
          ) : null}
          <View style={s.heroText}>
            <View style={s.pills}>
              <View style={[s.pill, { backgroundColor: RivalColors.event }]}>
                <RivalIcon name="flag" size={11} color="#2a2116" />
                <Text style={s.pillText}>{tag}</Text>
              </View>
              {division ? (
                <View style={[s.pill, s.pillSoft]}>
                  <Text style={[s.pillText, { color: RivalColors.event }]}>{division}</Text>
                </View>
              ) : null}
              {beat ? (
                <View style={[s.pill, { backgroundColor: PB_GOLD }]}>
                  <RivalIcon name="trophy" size={11} color="#2a2116" />
                  <Text style={s.pillText}>PB</Text>
                </View>
              ) : null}
            </View>
            <Text style={s.title} numberOfLines={2}>{race ? formatRaceName(race.name) : ''}</Text>
            {meta ? <Text style={s.meta} numberOfLines={1}>{meta}</Text> : null}
          </View>
        </View>

        <View style={s.body}>
          {kind !== 'days' ? (
            <View style={s.res}>
              <View style={{ flexShrink: 1 }}>
                <View style={s.lblRow}>
                  <Text style={s.lbl}>FINISH TIME</Text>
                  {own ? (
                    <TouchableOpacity onPress={() => setTimes(official == null && gapCount ? 'finish' : 'edit')} accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={s.editWord}>{official == null && gapCount ? 'Add official time' : 'Edit times'}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <GradientText style={[s.big, beat && s.bigGold]} numberOfLines={1}>{finish > 0 ? liveClock(finish) : '--:--'}</GradientText>
              </View>
              {last !== undefined ? (
                <View style={s.side}>
                  <Text style={[s.sideNum, !last && s.sideFirst]}>{last ? liveClock(last.seconds) : 'First time'}</Text>
                  <Text style={s.sideLbl}>{last ? `${last.year} TIME` : 'TIME TO BEAT'}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {kind === 'hyrox' ? <HyroxBar stats={hyroxStats ?? null} /> : null}

          {kind === 'legs' && legSecs > 0 ? (
            <>
              <View style={s.split}>
                {legs.flatMap((a, i) => {
                  const gap = trans.list[i]?.seconds;
                  return [
                    a.duration_seconds ? <View key={a.id} style={{ flex: a.duration_seconds, backgroundColor: BAR[i % BAR.length] }} /> : null,
                    gap ? <View key={`t${i}`} style={{ flex: gap, minWidth: 3, backgroundColor: 'rgba(255,255,255,0.38)' }} /> : null,
                  ];
                })}
              </View>
              {showSplitLabels ? (
                <View style={s.splitKeys}>
                  {legs.map((a, i) => {
                    const d = legDistance(a);
                    const pct = Math.round(((a.duration_seconds || 0) / (legSecs + (trans.total ?? 0))) * 100);
                    const dist = d ? ` ${d.num.replace(/\.0$/, '')} ${d.unit.toUpperCase()}` : '';
                    return <Text key={a.id} style={s.splitKey} numberOfLines={1}>{`${legName(race, a, i).toUpperCase()}${dist} · ${pct}%`}</Text>;
                  })}
                </View>
              ) : null}
              {trans.total ? (
                <View style={s.trn}>
                  <View style={s.trnSwatch} />
                  <Text style={s.trnText}>
                    {'Transitions '}<Text style={s.trnB}>{liveClock(trans.total)}</Text>
                    {` · ${Math.max(1, Math.round((trans.total / (legSecs + trans.total)) * 100))}%`}
                    {trans.list.every((t) => t.seconds) ? trans.list.map((t, i) => ` · ${transitionKey(i)} ${liveClock(t.seconds!)}`).join('') : ''}
                  </Text>
                </View>
              ) : null}
            </>
          ) : null}

          {placings.length ? (
            <>
              <View style={s.plh}>
                <Text style={s.plhT}>PLACINGS</Text>
                {own ? (
                  <TouchableOpacity style={s.plhE} onPress={() => setEditing(true)} accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={s.plhEText}>Edit</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <View style={s.plg}>
                {placings.slice(0, 3).map((r, i) => (
                  <View key={`${r.key}${i}`} style={[s.plCell, i > 0 && s.plCellRule]}>
                    <Text style={s.plK} numberOfLines={1}>{placingCaption(r).toUpperCase()}</Text>
                    <Text style={[s.plNum, i === 0 && s.plNumMain]}>
                      {(r.place ?? 0).toLocaleString()}
                      <Text style={[s.plSup, i === 0 && s.plSupMain]}>{ordinalSuffix(r.place ?? 0)}</Text>
                    </Text>
                    {r.of ? <Text style={s.plOf}>{`of ${r.of.toLocaleString()}`}</Text> : null}
                  </View>
                ))}
              </View>
            </>
          ) : own && race ? (
            <TouchableOpacity style={s.addPl} onPress={() => setEditing(true)} activeOpacity={0.85} accessibilityRole="button">
              <RivalIcon name="add" size={17} color={RivalColors.accentText} />
              <Text style={s.addPlText}>Add placings</Text>
              <Text style={s.addPlSub}>Overall, age group, division</Text>
            </TouchableOpacity>
          ) : null}

          {kind === 'race' && one ? <RaceDetail leg={one} d={oneDetail} ownerId={race?.user_id ?? null} /> : null}
          {kind === 'hyrox' ? <HyroxTable stats={hyroxStats ?? null} parts={parts} /> : null}
          {kind === 'days' ? <Days days={days} detail={detail} parts={parts} onOpenLeg={onOpenLeg} /> : null}

          {kind === 'legs' ? (
            <View style={s.tl}>
              {legs.flatMap((a, i) => {
                const d = legDistance(a);
                const pb = pbLegIds.has(a.id);
                const pace = a.distance_meters && a.duration_seconds ? formatSpeedOrPace(a.distance_meters, a.duration_seconds, a.activity_type) : null;
                const effort = Math.round((Number(a.effort_score) || 0) * 10) / 10;
                const gap = trans.list[i]?.seconds;
                const gapNode = gap ? (
                  <View key={`t${i}`} style={[s.node, s.nodeT]}>
                    <View style={[s.segment, beat && s.segmentPb, { pointerEvents: 'none' }]} />
                    <View style={s.dotT} />
                    <Text style={[s.kick, s.kickT]}>{transitionKey(i)}</Text>
                    <Text style={s.tmT}>{liveClock(gap)}</Text>
                  </View>
                ) : null;
                return [(
                  <TouchableOpacity key={a.id} style={s.node} activeOpacity={0.8} disabled={!onOpenLeg} onPress={() => onOpenLeg?.(a.id)} accessibilityRole="button" accessibilityLabel={legName(race, a, i)}>
                    {i < legs.length - 1 ? <View style={[s.segment, beat && s.segmentPb, { pointerEvents: 'none' }]} /> : null}
                    <View style={[s.dot, pb && { borderColor: PB_GOLD }]}>
                      <RivalIcon name={activityIconName(a.activity_type)} size={13} color={pb ? PB_GOLD : RivalColors.event} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={s.kickRow}>
                        <Text style={s.kick}>{legName(race, a, i).toUpperCase()}</Text>
                        {pb ? (
                          <View style={s.miniPb}>
                            <RivalIcon name="trophy" size={10} color="#2a2116" />
                            <Text style={s.miniPbText}>PB</Text>
                          </View>
                        ) : null}
                      </View>
                      {d ? <Text style={s.dist}>{d.num}<Text style={s.distUnit}>{` ${d.unit}`}</Text></Text> : null}
                      {pace ? <Text style={s.pace}>{pace}</Text> : null}
                    </View>
                    <View style={s.tm}>
                      <Text style={s.tmNum}>{a.duration_seconds ? liveClock(a.duration_seconds) : ''}</Text>
                      <Text style={s.tmEffort}>{`EFFORT ${effort}`}</Text>
                    </View>
                  </TouchableOpacity>
                ), gapNode];
              })}
            </View>
          ) : null}

          {photos.length ? (
            <View style={s.phs}>
              <View style={s.phsHead}>
                <Text style={[s.sec, { marginTop: 0, marginBottom: 0 }]}>PHOTOS</Text>
                <Text style={s.phsCount}>{photos.length === 1 ? '1 photo' : `${photos.length} photos`}</Text>
              </View>
              <View style={s.phsGrid}>
                {photos.slice(0, 4).map((p, i) => {
                  const more = i === 3 && photos.length > 4 ? photos.length - 4 : 0;
                  return (
                    <TouchableOpacity key={`${p.url}${i}`} style={s.ph} activeOpacity={0.85} disabled={!onOpenLeg} onPress={() => onOpenLeg?.(p.activityId)} accessibilityRole="button" accessibilityLabel="Open photo">
                      <CoverImage uri={p.url} focalX={p.focalX} focalY={p.focalY} style={StyleSheet.absoluteFill} />
                      {kind === 'days' ? (
                        <Text style={s.phDay}>{shortDay(legs.find((a) => a.id === p.activityId)?.started_at ?? '', { weekday: 'short' }).toUpperCase()}</Text>
                      ) : null}
                      {more ? <View style={s.phMore}><Text style={s.phMoreText}>{`+${more}`}</Text></View> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : null}

          {respect && respect.count > 0 ? (
            <View style={s.resp}>
              <View style={s.avs}>
                {respect.people.map((p, i) => (
                  <View key={p.id} style={[s.av, i > 0 && { marginLeft: -8 }]}>
                    <RivalAvatar uri={p.avatar} name={p.name} size={26} />
                  </View>
                ))}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.respTitle}>{`${respect.count} Respect`}</Text>
                <Text style={s.respSub}>{respect.from === 1 ? 'From 1 teammate' : `From ${respect.from} teammates`}</Text>
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>
      {/* Your own event: Share is the one gradient pill and Done turns ghost
          beside it (design/event-share-mockup.png); anyone else's keeps Done. */}
      <View style={[s.foot, own && s.footTwo]}>
        {own ? (
          <>
            <TouchableOpacity style={s.doneGhost} activeOpacity={0.85} onPress={onClose} accessibilityRole="button">
              <Text style={s.doneGhostText}>Done</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.done, { flex: 1.4 }]} activeOpacity={0.85} onPress={() => setSharing(true)} accessibilityRole="button">
              <View style={s.shareRow}>
                <RivalIcon name="share" size={18} color={RivalButtonColors.label(RivalColors.onAccentFill)} />
                <Text style={s.doneText}>Share</Text>
              </View>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={s.done} activeOpacity={0.85} onPress={onClose} accessibilityRole="button">
            <Text style={s.doneText}>Done</Text>
          </TouchableOpacity>
        )}
      </View>
      {race && sharing ? (
        <EventShare
          open={sharing}
          onClose={() => setSharing(false)}
          name={formatRaceName(race.name)}
          tag={tag}
          sub={shareSub}
          photo={sharePhoto ? { url: sharePhoto.url, focalX: sharePhoto.focalX, focalY: sharePhoto.focalY } : null}
          startedAt={legs[0]?.started_at ?? new Date().toISOString()}
          utcOffsetSeconds={legs[0]?.utc_offset_seconds}
          facts={shareFacts}
          effort={Math.round(totalEffort * 10) / 10}
        />
      ) : null}
    </View>
  );
}

// ---- A race: halves, pace per km, fastest efforts, details ---------------------------

/** The set distances (in metres) at which this run was a new fastest time,
 *  by the app's one rule (lib/bestEfforts.ts fastestBests): faster than every
 *  earlier run of the owner's at that distance. */
function useEffortPbs(leg: EventLeg, ownerId: string | null): Set<number> {
  const [pbs, setPbs] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!ownerId || !RUN_TYPES.has(leg.activity_type)) return;
    let live = true;
    (async () => {
      const { data } = await supabase.from('activities')
        .select('id, user_id, activity_type, started_at, distance_meters, duration_seconds, best_efforts')
        .eq('user_id', ownerId).in('activity_type', [...RUN_TYPES]).lte('started_at', leg.started_at)
        .order('started_at', { ascending: false }).limit(1000);
      if (!live) return;
      const won = fastestBests((data ?? []) as EffortRow[], distanceUnit() === 'mi')[leg.id] ?? [];
      setPbs(new Set(won.map((b) => b.meters)));
    })();
    return () => { live = false; };
  }, [leg.id, leg.started_at, leg.activity_type, ownerId]);
  return pbs;
}

function RaceDetail({ leg, d, ownerId }: { leg: EventLeg; d: Detail | undefined; ownerId: string | null }) {
  const effortPbs = useEffortPbs(leg, ownerId);
  const h = halves(d?.splits);
  const bars = paceBars(d?.splits);
  const efforts = raceEfforts(d?.best_efforts, leg.distance_meters ?? 0);
  const fastest = bars.length ? Math.min(...bars) : 0;
  const slowest = bars.length ? Math.max(...bars) : 0;
  const avgPace = leg.distance_meters && leg.duration_seconds ? paceText(leg.duration_seconds / (leg.distance_meters / 1000)) : null;
  const tiles: { num: string; unit?: string; label: string }[] = [];
  if (avgPace) tiles.push({ num: avgPace.num, unit: ` ${avgPace.unit}`, label: 'PACE' });
  if (d?.avg_heartrate) tiles.push({ num: String(Math.round(d.avg_heartrate)), unit: d.max_heartrate ? ` / ${Math.round(d.max_heartrate)}` : undefined, label: d.max_heartrate ? 'AVG / MAX BPM' : 'AVG BPM' });
  if (d?.avg_cadence) tiles.push({ num: String(Math.round(d.avg_cadence * (d.avg_cadence < 120 ? 2 : 1))), unit: ' spm', label: 'CADENCE' });
  if (d?.elevation_meters) tiles.push({ num: Math.round(toDisplayElevation(d.elevation_meters)).toLocaleString(), unit: ` ${elevationUnit()}`, label: 'ELEVATION' });
  if (d?.calories) tiles.push({ num: Math.round(d.calories).toLocaleString(), label: 'CALORIES' });
  if (leg.effort_score) tiles.push({ num: String(Math.round(Number(leg.effort_score))), label: 'EFFORT' });

  return (
    <>
      {h ? (
        <>
          <Text style={s.sec}>HALVES</Text>
          <View style={s.hv}>
            {[{ k: 'FIRST HALF', t: h.first, m: h.firstM }, { k: 'SECOND HALF', t: h.second, m: h.secondM }].map((x, i) => {
              const p = paceText(x.t / (x.m / 1000));
              return (
                <View key={x.k} style={[{ flex: 1 }, i > 0 && s.hvRule]}>
                  <Text style={s.tileK}>{x.k}</Text>
                  <Text style={s.hvNum}>{liveClock(x.t)}<Text style={s.hvPace}>{`  ${p.num} ${p.unit}`}</Text></Text>
                </View>
              );
            })}
          </View>
          {h.second < h.first ? (
            <View style={s.neg}>
              <RivalIcon name="trendDown" size={14} color={RivalColors.event} />
              <Text style={s.negText}><Text style={s.negB}>Negative split</Text>{` · second half ${liveClock(h.first - h.second)} quicker`}</Text>
            </View>
          ) : null}
        </>
      ) : null}

      {bars.length >= 3 ? (
        <>
          <Text style={s.sec}>PACE PER KM</Text>
          <View style={s.bars}>
            {bars.map((b, i) => {
              // Taller is quicker: the slowest km sits at a third of the height.
              const f = slowest === fastest ? 1 : 0.35 + 0.65 * ((slowest - b) / (slowest - fastest));
              return <View key={i} style={[s.bar, { height: `${Math.round(f * 100)}%` as any }, b === fastest && s.barFast]} />;
            })}
          </View>
          <View style={s.barsK}>
            <Text style={s.barsKText}>1 KM</Text>
            <Text style={s.barsKText}>{String(Math.ceil(bars.length / 2))}</Text>
            <Text style={s.barsKText}>{String(Math.round(((leg.distance_meters ?? 0) / 1000) * 10) / 10)}</Text>
          </View>
        </>
      ) : null}

      {efforts.length ? (
        <>
          <Text style={s.sec}>FASTEST EFFORTS IN THIS RACE</Text>
          <View style={s.row3}>
            {efforts.map((e) => (
              <View key={e.name} style={s.tile3}>
                <View style={s.tileKRow}>
                  <Text style={s.tileK}>{e.label.toUpperCase()}</Text>
                  {effortPbs.has(effortDistance(e.distance)?.meters ?? -1) ? (
                    <View style={s.miniPb}>
                      <RivalIcon name="trophy" size={10} color="#2a2116" />
                      <Text style={s.miniPbText}>PB</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={s.tileNum}>{liveClock(e.seconds)}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {tiles.length ? (
        <>
          <Text style={s.sec}>DETAILS</Text>
          <View style={s.grid3}>
            {tiles.map((t) => (
              <View key={t.label} style={s.gridTile}>
                <Text style={s.tileNum} numberOfLines={1}>{t.num}{t.unit ? <Text style={s.tileUnit}>{t.unit}</Text> : null}</Text>
                <Text style={s.tileK}>{t.label}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </>
  );
}

// ---- HYROX --------------------------------------------------------------------------

function HyroxBar({ stats }: { stats: ActivityStats | null }) {
  const rows = hyroxRows(stats?.laps, !!stats?.wod?.roxzone);
  if (!rows.length) return null;
  const running = rows.reduce((t, r) => t + (r.run ?? 0), 0);
  const stations = rows.reduce((t, r) => t + (r.time ?? 0), 0);
  const rox = rows.reduce((t, r) => t + (r.rox ?? 0), 0);
  const all = running + stations + rox || 1;
  const keys = [
    { label: 'RUNNING', secs: running, color: BAR[0] },
    { label: 'STATIONS', secs: stations, color: BAR[1] },
    ...(rox ? [{ label: 'ROXZONE', secs: rox, color: BAR[2] }] : []),
  ];
  return (
    <>
      <View style={s.split}>
        {keys.map((k) => <View key={k.label} style={{ flex: k.secs, backgroundColor: k.color }} />)}
      </View>
      <View style={s.splitKeys}>
        {keys.map((k, i) => (
          <View key={k.label} style={{ alignItems: i === 0 ? 'flex-start' : i === keys.length - 1 ? 'flex-end' : 'center' }}>
            <Text style={[s.hxkNum, { color: k.color }]}>{liveClock(k.secs)}</Text>
            <Text style={[s.hxkLbl, { color: k.color }]}>{`${k.label} ${Math.round((k.secs / all) * 100)}%`}</Text>
          </View>
        ))}
      </View>
    </>
  );
}

function HyroxTable({ stats, parts }: { stats: ActivityStats | null; parts: Record<string, number | null> }) {
  const rox = !!stats?.wod?.roxzone;
  const rows = hyroxRows(stats?.laps, rox);
  if (!rows.length) return null;
  const rank = (k: string) => {
    const n = parts[k];
    return n ? `${n.toLocaleString()}${ordinalSuffix(n)}` : null;
  };
  return (
    <>
      <Text style={[s.sec, s.secPeach]}>EACH 1 KM RUN, THEN ITS STATION</Text>
      <View style={s.hxh}>
        <Text style={[s.hxhT, { width: 22 }]}>#</Text>
        <Text style={[s.hxhT, { width: 54 }]}>RUN</Text>
        <Text style={[s.hxhT, { flex: 1 }]}>STATION</Text>
        {rox ? <Text style={[s.hxhT, s.hxhRox]}>ROX</Text> : null}
      </View>
      <View style={s.hxTable}>
        {rows.map((r, i) => (
          <View key={r.n} style={[s.hxr, i > 0 && s.hxrRule]}>
            <Text style={s.hxN}>{r.n}</Text>
            <View style={s.hxRun}>
              <Text style={s.hxRunT}>{r.run != null ? liveClock(r.run) : '-'}</Text>
              {rank(`run${r.n}`) ? <Text style={s.hxRank}>{rank(`run${r.n}`)}</Text> : null}
            </View>
            <View style={s.hxSt}>
              <Text style={s.hxStName} numberOfLines={1}>{r.station}{r.metres ? <Text style={s.hxStM}>{` ${r.metres}`}</Text> : null}</Text>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={s.hxStT}>{r.time != null ? liveClock(r.time) : '-'}</Text>
                {rank(`st${r.n}`) ? <Text style={s.hxRank}>{rank(`st${r.n}`)}</Text> : null}
              </View>
            </View>
            {rox ? <Text style={s.hxRox}>{r.rox != null ? liveClock(r.rox) : '-'}</Text> : null}
          </View>
        ))}
      </View>
    </>
  );
}

// ---- Several days -----------------------------------------------------------------------

/** An event's score, compact for its card: "12:30", "115 kg", "9+12 reps". */
function eventScore(st: ActivityStats | null, seconds: number | null): { num: string; unit?: string } {
  const sc = st?.score;
  if (!sc) return { num: seconds ? liveClock(seconds) : '' };
  if (sc.kind === 'time') return { num: liveClock(sc.seconds ?? 0) };
  if (sc.kind === 'weight') {
    const [num, unit] = formatWeight(sc.kg ?? 0).split(' ');
    return { num, unit };
  }
  if (sc.kind === 'reps') return { num: String(sc.reps ?? 0), unit: 'reps' };
  const r = sc.rounds ?? 0;
  return sc.reps ? { num: `${r}+${sc.reps}`, unit: 'reps' } : { num: String(r), unit: r === 1 ? 'round' : 'rounds' };
}

function Days({ days, detail, parts, onOpenLeg }: {
  days: ReturnType<typeof byDay<EventLeg & { stats: ActivityStats | null }>>;
  detail: Record<string, Detail>;
  parts: Record<string, number | null>;
  onOpenLeg?: (id: string) => void;
}) {
  const all = days.reduce((t, d) => t + d.seconds, 0) || 1;
  const legs = days.flatMap((d) => d.legs);
  const effort = Math.round(legs.reduce((t, a) => t + (Number(a.effort_score) || 0), 0));
  const worked = legs.reduce((t, a) => t + (a.duration_seconds || 0), 0);
  const colour = (i: number) => BAR[Math.min(i, BAR.length - 1)];
  let n = 0;
  return (
    <>
      <View style={[s.split, { marginTop: 12 }]}>
        {days.map((d, i) => <View key={d.day} style={{ flex: d.seconds || 1, backgroundColor: colour(i) }} />)}
      </View>
      <View style={s.splitKeys}>
        {days.map((d, i) => (
          <Text key={d.day} style={[s.splitKey, { color: colour(i) }]}>
            {`${shortDay(d.legs[0].started_at, { weekday: 'short' }).toUpperCase()} ${Math.round(d.seconds / 60)} MIN`}
          </Text>
        ))}
      </View>
      <Text style={s.dsum}>{`${legs.length} ${legs.length === 1 ? 'event' : 'events'} · ${liveClock(worked)} worked · ${effort} Effort`}</Text>
      {days.map((d, di) => (
        <View key={d.day}>
          <View style={s.dh}>
            <View style={[s.dhDot, { backgroundColor: colour(di) }]} />
            <Text style={s.dhDay}>{shortDay(d.legs[0].started_at, { weekday: 'long' })}</Text>
            <Text style={s.dhN}>{`DAY ${di + 1}`}</Text>
          </View>
          {d.legs.map((a) => {
            n += 1;
            const det = detail[a.id];
            const st = det?.stats ?? null;
            const fmt = st?.wod?.format ? `${WOD_LABEL[st.wod.format]}${st.wod.format === 'amrap' && st.wod.minutes ? ` ${st.wod.minutes}` : ''}` : null;
            const moves = st?.wod?.movements?.length
              ? st.wod.movements.map((m) => (m.reps ? `${m.reps} ${m.name}` : m.name)).join(' · ')
              : (det?.exercises ?? []).map((x) => x.name).filter(Boolean).join(' · ');
            const score = eventScore(st, a.duration_seconds);
            const place = parts[a.id];
            const eff = Math.round((Number(a.effort_score) || 0) * 10) / 10;
            return (
              <TouchableOpacity key={a.id} style={s.evc} activeOpacity={0.85} disabled={!onOpenLeg} onPress={() => onOpenLeg?.(a.id)} accessibilityRole="button">
                <View style={[s.evStrip, { backgroundColor: colour(di) }]} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={s.evTop}>
                    <Text style={s.evName}>{(det?.name && !/^(morning|afternoon|evening|lunch|night)\b/i.test(det.name) ? det.name : `Event ${n}`).toUpperCase()}</Text>
                    {fmt ? <View style={s.fmt}><Text style={s.fmtText}>{fmt.toUpperCase()}</Text></View> : null}
                  </View>
                  {moves ? <Text style={s.evMv}>{moves}</Text> : null}
                </View>
                <View style={s.evRt}>
                  <Text style={s.evSc}>{score.num}{score.unit ? <Text style={s.evScUnit}>{` ${score.unit}`}</Text> : null}</Text>
                  <View style={{ alignItems: 'flex-end' }}>
                    {place ? <View style={s.ep}><Text style={s.epText}>{`${place.toLocaleString()}${ordinalSuffix(place)}`.toUpperCase()}</Text></View> : null}
                    <Text style={s.ef}>{`EFFORT ${eff}`}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#282828', borderTopLeftRadius: 22, borderTopRightRadius: 22,
    borderTopWidth: 1, borderColor: '#323232', overflow: 'hidden',
    ...(web ? ({ touchAction: 'pan-y' } as any) : {}),
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  hero: { height: 232, justifyContent: 'flex-end' },
  heroArt: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  heroShade: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    ...(web
      ? { backgroundImage: 'linear-gradient(0deg, #282828 0%, rgba(40,40,40,0.85) 22%, rgba(40,40,40,0) 62%)' } as any
      : { backgroundColor: 'rgba(40,40,40,0.4)' }),
  },
  grabber: { position: 'absolute', top: 10, alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.55)' },
  heroText: { paddingHorizontal: 18, paddingBottom: 4 },
  pills: { flexDirection: 'row', gap: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 20, paddingHorizontal: 7, borderRadius: 999 },
  pillText: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', color: '#2a2116' },
  title: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 30, lineHeight: 34, color: '#fff', marginTop: 8 },
  meta: { fontSize: 12.5, color: 'rgba(255,255,255,0.7)', marginTop: 3 },

  body: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 8 },
  res: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 },
  lbl: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: RivalColors.textSecondary },
  lblRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // Edit is a word, never a pencil (AGENTS.md mockup checklist).
  editWord: { fontSize: 12.5, fontWeight: '700', color: RivalColors.accentText },
  trn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  trnSwatch: { width: 14, height: 6, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.38)' },
  trnText: { fontSize: 11.5, color: RivalColors.textSecondary },
  trnB: { color: '#fff', fontWeight: '700' },
  nodeT: { minHeight: 32, paddingVertical: 2 },
  dotT: { position: 'absolute', left: -24, zIndex: 1, width: 12, height: 12, borderRadius: 6, backgroundColor: '#2c2c2c', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.45)' },
  kickT: { flex: 1, color: 'rgba(255,255,255,0.62)' },
  tmT: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 14, color: 'rgba(255,255,255,0.85)' },
  menuWrap: { position: 'absolute', top: 14, right: 14, zIndex: 5 },
  moreBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.38)', alignItems: 'center', justifyContent: 'center', ...(web ? { backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' } as any : {}) },
  menuBackdrop: { position: web ? ('fixed' as any) : 'absolute', top: -2000, left: -2000, right: -2000, bottom: -2000 },
  // The pop-ups' grey, as an activity's ⋯ menu.
  menu: {
    position: 'absolute', top: 40, right: 0, minWidth: 200,
    borderRadius: 14, paddingVertical: 6, backgroundColor: RivalColors.surfaceHigh,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    ...(web ? { boxShadow: '0px 10px 24px rgba(0,0,0,0.45)', transformOrigin: 'top right' } as any : {}),
  },
  menuCaret: {
    position: 'absolute', top: -6, right: 10, width: 12, height: 12,
    backgroundColor: RivalColors.surfaceHigh, borderTopWidth: 1, borderLeftWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    transform: [{ rotate: '45deg' }],
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14 },
  menuText: { fontSize: 14, fontWeight: '600', color: RivalColors.onSurface },
  big: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 46, lineHeight: 50, color: '#fff' },
  bigGold: web
    ? ({ backgroundImage: `linear-gradient(180deg, #FFF6CC 0%, ${PB_GOLD} 55%, #C9962B 100%)`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' } as any)
    : ({ color: PB_GOLD, __gradientText: `linear-gradient(180deg, #FFF6CC 0%, ${PB_GOLD} 55%, #C9962B 100%)` } as any),
  side: { alignItems: 'flex-end', paddingBottom: 6 },
  sideNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 20, color: '#fff' },
  sideFirst: { fontSize: 18 },
  sideLbl: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: RivalColors.textSecondary },
  split: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2, marginTop: 14 },
  splitKeys: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  // One line each at phone width, as in the mockup.
  splitKey: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5, color: RivalColors.textSecondary },

  tl: { marginTop: 16, paddingLeft: 30 },
  node: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 62, paddingVertical: 5 },
  // Circle to circle: from this leg's circle down to the next one's.
  segment: { position: 'absolute', left: -19, top: '50%', height: '100%', width: 2, backgroundColor: RivalColors.event, opacity: 0.4 },
  segmentPb: web
    ? ({ backgroundImage: `linear-gradient(180deg, ${RivalColors.event}, ${PB_GOLD})`, backgroundColor: 'transparent', opacity: 0.5 } as any)
    : { opacity: 0.5 },
  dot: {
    position: 'absolute', left: -30, zIndex: 1, width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#323232', borderWidth: 1.5, borderColor: RivalColors.event, alignItems: 'center', justifyContent: 'center',
  },
  kickRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kick: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: RivalColors.textSecondary },
  miniPb: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 18, paddingHorizontal: 6, borderRadius: 999, backgroundColor: PB_GOLD },
  miniPbText: { fontSize: 8.5, fontWeight: '800', letterSpacing: 0.5, color: '#2a2116' },
  dist: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 20, color: '#fff', marginVertical: 1 },
  distUnit: { fontFamily: 'Manrope', fontStyle: 'normal', fontSize: 12, fontWeight: '700', color: RivalColors.textSecondary },
  pace: { fontSize: 11.5, color: RivalColors.textSecondary },
  tm: { alignItems: 'flex-end' },
  tmNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 18, color: '#fff' },
  tmEffort: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: RivalColors.accentText },

  resp: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 14, backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border,
  },
  avs: { flexDirection: 'row' },
  av: { borderRadius: 15, borderWidth: 2, borderColor: '#282828' },
  respTitle: { fontSize: 13, fontWeight: '700', color: '#fff' },
  respSub: { fontSize: 12, color: RivalColors.textSecondary },

  pillSoft: { backgroundColor: 'rgba(244,234,216,0.16)' },
  sec: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: RivalColors.textSecondary, marginTop: 14, marginBottom: 7 },
  secPeach: { color: RivalColors.accentText },

  // Placings (design/event-placings-mockup.png): ivory card, the first one large.
  plh: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 13 },
  plhT: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: RivalColors.event },
  plhE: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  plhEText: { fontSize: 11, fontWeight: '700', color: RivalColors.accentText },
  plg: {
    flexDirection: 'row', marginTop: 9, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 3,
    borderWidth: 1, borderColor: 'rgba(244,234,216,0.28)', backgroundColor: 'rgba(244,234,216,0.07)',
    ...(web ? ({ backgroundImage: 'linear-gradient(135deg, rgba(244,234,216,0.15), rgba(244,234,216,0.04) 65%)' } as any) : {}),
  },
  plCell: { flex: 1, paddingHorizontal: 9, minWidth: 0 },
  plCellRule: { borderLeftWidth: 1, borderLeftColor: 'rgba(244,234,216,0.18)' },
  plK: { fontSize: 8, fontWeight: '800', letterSpacing: 1, color: RivalColors.event },
  plNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 19, lineHeight: 22, color: '#fff', marginTop: 2 },
  plNumMain: { fontSize: 24, lineHeight: 25, color: RivalColors.event },
  plSup: { fontSize: 9, ...(web ? ({ verticalAlign: 'super', lineHeight: 0 } as any) : {}) },
  plSupMain: { fontSize: 10 },
  plOf: { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.72)' },
  addPl: {
    flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 13, paddingVertical: 11, paddingHorizontal: 12,
    borderRadius: 14, borderWidth: 1, borderColor: RivalGhost.border, backgroundColor: RivalGhost.fill,
  },
  addPlText: { fontSize: 13.5, fontWeight: '700', color: RivalColors.accentText },
  addPlSub: { flex: 1, textAlign: 'right', fontSize: 11.5, color: RivalColors.textSecondary },

  // A race.
  hv: { flexDirection: 'row', borderRadius: 14, paddingVertical: 9, paddingHorizontal: 12, backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border },
  hvRule: { borderLeftWidth: 1, borderLeftColor: 'rgba(255,209,190,0.10)', paddingLeft: 12, marginLeft: 12 },
  hvNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 18, color: '#fff' },
  hvPace: { fontFamily: 'Manrope', fontStyle: 'normal', fontWeight: '500', fontSize: 11, color: RivalColors.textSecondary },
  neg: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 7 },
  negText: { fontSize: 11.5, color: RivalColors.textSecondary },
  negB: { color: RivalColors.event, fontWeight: '700' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 58, paddingHorizontal: 2 },
  bar: { flex: 1, borderTopLeftRadius: 3, borderTopRightRadius: 3, borderBottomLeftRadius: 1, borderBottomRightRadius: 1, backgroundColor: RivalColors.accentText, opacity: 0.85 },
  barFast: { backgroundColor: RivalColors.event, opacity: 1 },
  barsK: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  barsKText: { fontSize: 9.5, fontWeight: '800', letterSpacing: 1, color: RivalColors.textSecondary },
  row3: { flexDirection: 'row', gap: 6 },
  tile3: { flex: 1, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 14, backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border },
  grid3: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  gridTile: { width: '31.9%', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 14, backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border },
  tileKRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tileK: { fontSize: 9, fontWeight: '800', letterSpacing: 1.1, color: RivalColors.textSecondary },
  tileNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 17, lineHeight: 21, color: '#fff', marginTop: 2 },
  tileUnit: { fontFamily: 'Manrope', fontStyle: 'normal', fontSize: 10.5, fontWeight: '700', color: RivalColors.textSecondary },

  // HYROX: running ivory, stations light peach, Roxzone salmon; never red.
  hxkNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 17 },
  hxkLbl: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  hxh: { flexDirection: 'row', paddingHorizontal: 12, paddingBottom: 6, gap: 8 },
  hxhT: { fontSize: 9, fontWeight: '800', letterSpacing: 1.1, color: RivalColors.textSecondary },
  hxhRox: { width: 34, textAlign: 'right', color: RivalColors.accentText },
  hxTable: { borderRadius: 14, paddingHorizontal: 12, backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border },
  hxr: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingVertical: 4 },
  hxrRule: { borderTopWidth: 1, borderTopColor: 'rgba(255,209,190,0.08)' },
  hxN: { width: 14, fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 13, color: RivalColors.accentText },
  hxRun: { width: 46 },
  hxRunT: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 15, color: RivalColors.event },
  hxRank: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6, color: RivalColors.event, marginTop: 1 },
  hxSt: {
    flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6, paddingLeft: 10,
    borderLeftWidth: 1, borderLeftColor: 'rgba(255,181,158,0.22)', minWidth: 0,
  },
  hxStName: { flexShrink: 1, fontSize: 11.5, fontWeight: '700', color: '#fff' },
  hxStM: { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.72)' },
  hxStT: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 15, color: '#fff' },
  hxRox: { width: 34, textAlign: 'right', fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 13, color: RivalColors.accentText },

  // Several days.
  dsum: { fontSize: 11.5, color: RivalColors.textSecondary, marginTop: 8 },
  dh: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, marginBottom: 8 },
  dhDot: { width: 10, height: 10, borderRadius: 5 },
  dhDay: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 18, color: '#fff' },
  dhN: { marginLeft: 'auto', fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: RivalColors.textSecondary },
  evc: {
    flexDirection: 'row', gap: 12, borderRadius: 16, paddingVertical: 11, paddingRight: 13, paddingLeft: 15, marginBottom: 7,
    backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border, overflow: 'hidden',
  },
  evStrip: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  evTop: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  evName: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#fff' },
  fmt: { paddingVertical: 3, paddingHorizontal: 7, borderRadius: 999, backgroundColor: 'rgba(255,181,158,0.16)' },
  fmtText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8, color: RivalColors.accentText },
  evMv: { marginTop: 6, fontSize: 13, lineHeight: 18, fontWeight: '600', color: '#fff' },
  evRt: { alignItems: 'flex-end', justifyContent: 'space-between' },
  evSc: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 24, lineHeight: 26, color: '#fff' },
  evScUnit: { fontFamily: 'Manrope', fontStyle: 'normal', fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.7)' },
  ep: { marginTop: 6, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, backgroundColor: RivalColors.event },
  epText: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.8, color: '#2a2116' },
  ef: { marginTop: 5, fontSize: 9.5, fontWeight: '800', letterSpacing: 1, color: RivalColors.accentText },

  // Photos from the event's activities.
  phs: { marginTop: 14 },
  phsHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  phsCount: { fontSize: 12, fontWeight: '700', color: RivalColors.accentText },
  phsGrid: { flexDirection: 'row', gap: 6 },
  ph: { flex: 1, aspectRatio: 1, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,209,190,0.10)', backgroundColor: '#323232' },
  phDay: { position: 'absolute', left: 6, bottom: 5, fontSize: 8, fontWeight: '800', letterSpacing: 0.8, color: '#fff', ...(web ? ({ textShadow: '0 1px 3px rgba(0,0,0,0.7)' } as any) : {}) },
  phMore: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.52)', alignItems: 'center', justifyContent: 'center' },
  phMoreText: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 18, color: '#fff' },

  foot: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 26 },
  done: {
    height: 52, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    ...(web ? ({ backgroundImage: 'linear-gradient(90deg, #D97757, #ffb59e)' } as any) : { backgroundColor: '#D97757' }),
  },
  footTwo: { flexDirection: 'row', gap: 8 },
  doneGhost: { flex: 1, height: 52, borderRadius: 999, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,181,158,0.35)' },
  doneGhostText: { fontSize: 15, fontWeight: '700', color: RivalColors.accentText },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  doneText: { fontSize: 15, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill) },
});
