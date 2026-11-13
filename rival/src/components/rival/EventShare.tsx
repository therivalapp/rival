import { useEffect, useRef, useState } from 'react';
import { Image, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Modal } from './RivalModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RivalBackButton } from './RivalBackButton';
import { RivalIcon } from './RivalIcon';
import { BusyText } from './BusyText';
import { StatTiles } from './StatTiles';
import { StampStage } from './StampStage';
import { RivalButtonColors, RivalColors, RivalGhost } from '../../constants/rivalTheme';
import { composeStampOnPhoto, makeShareCard, shareCardFile, type StampPlacement } from '../../lib/shareCard';
import {
  centredStamp,
  MAX_STATS, STAMP_STYLES, chosenFigures, drawEventStamp, drawStamp, inkMargins, stampBlob, stampFontsReady,
  type InkMargins, type StampMode, type StampStyle, type StatKey,
} from '../../lib/shareStamp';
import { defaultEventStats, eventRowFigures, eventStatOptions, placeHero, type EventShareFacts } from '../../lib/eventShare';
import { liveClock } from '../../lib/liveActivity';
import { webFx } from '../../lib/webFx';

// Sharing a whole event (Ricky, 2026-11-05, design/event-share-mockup.png):
// the activity share pop-up (ActivityDiaryViewer's cardSheet) with two event
// stamps leading the strip, in the events' ivory and labelled "Event":
// Finish, the time as the hero, and Place, the place as the hero. The usual
// stamps and the card follow. Placings join the stat tiles with an ivory
// edge; Effort is always on, last, in gold.

type Pic = { url: string; blob: Blob; ink?: InkMargins };
type Choice = 'card' | 'finish' | 'place' | StampStyle;

const EVENT_PLACEMENT: StampPlacement = { cx: 0.5, cy: 0.6, w: 0.8 };
const STAMP_PLACEMENT: StampPlacement = { cx: 0.5, cy: 0.8, w: 0.92 };

export function EventShare({ open, onClose, name, tag, sub, photo, startedAt, utcOffsetSeconds, facts, effort }: {
  open: boolean;
  onClose: () => void;
  name: string;
  /** "Marathon", "HYROX": the card's kicker. */
  tag: string;
  /** "FRI 14 – SUN 16 AUG · 5 EVENTS", for several days. */
  sub?: string | null;
  photo: { url: string; focalX: number; focalY: number } | null;
  startedAt: string;
  utcOffsetSeconds?: number | null;
  facts: EventShareFacts;
  effort: number;
}) {
  const insets = useSafeAreaInsets();
  const { width: ww, height: wh } = useWindowDimensions();
  const [mode, setMode] = useState<StampMode>(() => {
    try { return (globalThis.localStorage?.getItem('rival.stampMode') as StampMode) || 'light'; } catch { return 'light'; }
  });
  const [keys, setKeys] = useState<StatKey[] | null>(null);
  const [choice, setChoice] = useState<Choice>('finish');
  const [placement, setPlacement] = useState<StampPlacement>(EVENT_PLACEMENT);
  const [card, setCard] = useState<Pic | null>(null);
  const [finishStamp, setFinishStamp] = useState<Pic | null>(null);
  const [placeStamp, setPlaceStamp] = useState<Pic | null>(null);
  const [stamps, setStamps] = useState<(Pic & { style: StampStyle })[]>([]);
  const [making, setMaking] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urls = useRef<string[]>([]);
  const [enlarged, setEnlarged] = useState(false);

  const options = eventStatOptions(facts);

  useEffect(() => {
    if (!open) return;
    setEnlarged(false);
    const k = defaultEventStats(options, facts);
    setKeys(k);
    // HYROX and several days lead with the place; a race with its time.
    const lead: Choice = (facts.kind === 'hyrox' || facts.kind === 'days') && placeHero(options, k) ? 'place' : 'finish';
    setChoice(lead);
    setPlacement(EVENT_PLACEMENT);
    build(k, mode);
    return () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); urls.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function build(k: StatKey[], m: StampMode) {
    if (Platform.OS !== 'web') { setError('Sharing an event is not available here yet.'); return; }
    setMaking(true);
    setError(null);
    try {
      await stampFontsReady();
      const keep = (b: Blob, ink?: InkMargins): Pic => {
        const url = URL.createObjectURL(b);
        urls.current.push(url);
        return { url, blob: b, ink };
      };
      const time = facts.finishSeconds > 0 ? liveClock(facts.finishSeconds) : null;
      const fin = () => drawEventStamp('finish', { name, time, sub }, eventRowFigures(options, k, time ? 'finish' : null, effort), m);
      const hero = placeHero(options, k);
      const row = hero ? facts.placings[Number(hero.key.slice(2))] : null;
      const caption = hero ? `${hero.label}${row?.of ? ` · of ${row.of.toLocaleString()}` : ''}` : '';
      const plc = hero && row?.place
        ? () => drawEventStamp('place', { name, place: { n: row.place!, caption }, sub }, eventRowFigures(options, k, hero.key, effort), m)
        : null;
      const figures = chosenFigures(options, k, effort, true);
      const [cardBlob, finBlob, plcBlob, made] = await Promise.all([
        makeShareCard({ photoUrl: photo?.url ?? null, focalX: photo?.focalX, focalY: photo?.focalY, kicker: tag, name, figures, startedAt, utcOffsetSeconds }),
        time ? stampBlob(fin()) : Promise.resolve(null),
        plc ? stampBlob(plc()) : Promise.resolve(null),
        Promise.all(STAMP_STYLES.map(async (style) => ({ style, blob: await stampBlob(drawStamp(style, name, figures, m)), ink: inkMargins(() => drawStamp(style, name, figures, m)) }))),
      ]);
      setCard(keep(cardBlob));
      setFinishStamp(finBlob ? keep(finBlob, inkMargins(fin)) : null);
      setPlaceStamp(plcBlob && plc ? keep(plcBlob, inkMargins(plc)) : null);
      setStamps(made.map((x) => ({ ...keep(x.blob, x.ink), style: x.style })));
    } catch {
      setError('The picture could not be made. Try again.');
    } finally {
      setMaking(false);
    }
  }

  function chosen(): Pic | null {
    if (choice === 'card') return null;
    if (choice === 'finish') return finishStamp;
    if (choice === 'place') return placeStamp;
    return stamps.find((s) => s.style === choice) ?? null;
  }

  function toggle(key: StatKey) {
    if (!keys || making) return;
    const on = keys.includes(key);
    if (!on && keys.length >= MAX_STATS) return;
    const next = on ? keys.filter((k) => k !== key) : [...keys, key];
    setKeys(next);
    build(next, mode);
  }

  function pickMode(m: StampMode) {
    if (m === mode || making || !keys) return;
    setMode(m);
    try { globalThis.localStorage?.setItem('rival.stampMode', m); } catch {}
    build(keys, m);
  }

  async function send(stampOnly = false) {
    if (!card || sending) return;
    const base = `rival-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    const stamp = chosen();
    setSending(true);
    setError(null);
    try {
      let done: 'shared' | 'saved' | 'cancelled';
      if (!stamp) done = await shareCardFile(card.blob, `${base}.jpg`);
      else if (stampOnly || !photo) done = await shareCardFile(await centredStamp(stamp.blob), `${base}-stamp.png`);
      else done = await shareCardFile(await composeStampOnPhoto({ photoUrl: photo.url, focalX: photo.focalX, focalY: photo.focalY, stampUrl: stamp.url, placement }), `${base}.jpg`);
      if (done !== 'cancelled') onClose();
    } catch {
      setError('Sharing did not open. Try again.');
    } finally {
      setSending(false);
    }
  }

  const h = Math.min(wh * 0.46, (ww - 96) * 16 / 9);
  const stamp = chosen();

  // The photo with the card or the placed stamp, and the corner button that
  // enlarges it to the full screen or brings it back, as on an activity's
  // share (ActivityDiaryViewer sharePreview). The button sits beside the
  // stage, not in it, so it never starts a drag.
  function preview(height: number, full: boolean) {
    if (!card) return null;
    return (
      <View>
        {stamp
          ? <StampStage photoUrl={photo?.url ?? null} stampUrl={stamp.url} inkHint={stamp.ink} height={height} placement={placement} onChange={setPlacement} />
          : (
            <>
              <Image source={{ uri: card.url }} style={[e.cardPreview, { height }]} resizeMode="contain" />
              <Text style={e.hintSpace} aria-hidden>Drag to move</Text>
            </>
          )}
        <TouchableOpacity
          style={e.enlargeBtn}
          onPress={() => setEnlarged(!full)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel={full ? 'Make smaller' : 'Enlarge'}
        >
          <RivalIcon name={full ? 'shrink' : 'enlarge'} size={15} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>
      </View>
    );
  }
  const eventTile = (c: 'finish' | 'place', pic: Pic | null, label: string) => (pic ? (
    <TouchableOpacity
      key={c}
      style={[e.choice, e.choiceEvent, mode === 'dark' && e.choiceDark, choice === c && e.choiceOn]}
      onPress={() => { setChoice(c); setPlacement(EVENT_PLACEMENT); }}
      accessibilityLabel={label}
    >
      <Image source={{ uri: pic.url }} style={e.choiceEventImg} resizeMode="contain" />
      <Text style={[e.choiceEventLabel, mode === 'dark' && e.choiceEventLabelDark]}>Event</Text>
    </TouchableOpacity>
  ) : null);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={e.sheet}>
        <ScrollView contentContainerStyle={[e.content, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
          {card ? preview(h, false) : <View style={[e.cardPreview, e.placeholder, { height: h }]} />}

          <View style={e.wrap}>
            <View style={e.head}>
              <Text style={e.hint}>Swipe for more</Text>
              <View style={[e.seg, choice === 'card' && { opacity: 0.4 }]}>
                {(['light', 'dark'] as const).map((m) => (
                  <TouchableOpacity key={m} style={[e.segOpt, mode === m && e.segOptOn]} onPress={() => pickMode(m)} disabled={choice === 'card'} accessibilityState={{ selected: mode === m }}>
                    <Text style={[e.segText, mode === m && e.segTextOn]}>{m === 'light' ? 'Light' : 'Dark'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={e.strip} contentContainerStyle={e.row}>
                {card ? (
                  <TouchableOpacity style={[e.choice, choice === 'card' && e.choiceOn]} onPress={() => setChoice('card')} accessibilityLabel="Share card">
                    <Image source={{ uri: card.url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  </TouchableOpacity>
                ) : null}
                {eventTile('finish', finishStamp, 'Finish stamp')}
                {eventTile('place', placeStamp, 'Place stamp')}
                {stamps.map((st, i) => (
                  <TouchableOpacity key={st.style} style={[e.choice, e.choiceStamp, mode === 'dark' && e.choiceDark, choice === st.style && e.choiceOn]} onPress={() => { setChoice(st.style); setPlacement(STAMP_PLACEMENT); }} accessibilityLabel={`Stamp ${i + 1}`}>
                    <Image source={{ uri: st.url }} style={e.choiceStampImg} resizeMode="contain" />
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={[e.fade, { pointerEvents: 'none' }]} />
            </View>
          </View>

          {keys ? (
            <View style={e.card}>
              <StatTiles options={options} chosen={keys} effort={effort} onToggle={toggle} />
            </View>
          ) : null}

          <TouchableOpacity style={e.shareBtn} onPress={() => send()} disabled={sending || !card} activeOpacity={0.85} accessibilityRole="button">
            <RivalIcon name="share" size={18} color={RivalButtonColors.label(RivalColors.onAccentFill)} />
            <BusyText busy={sending} style={e.shareText}>{sending ? 'Making…' : 'Share'}</BusyText>
          </TouchableOpacity>
          {photo ? (
            <TouchableOpacity onPress={() => send(true)} disabled={choice === 'card'} style={choice === 'card' ? { opacity: 0 } : undefined} hitSlop={{ top: 6, bottom: 6, left: 16, right: 16 }}>
              <Text style={e.link}>Save transparent stamp</Text>
            </TouchableOpacity>
          ) : null}
          {error ? <Text style={e.error}>{error}</Text> : null}
        </ScrollView>
        <RivalBackButton onPress={onClose} color="#fff" style={[e.back, { top: insets.top + 12 }]} />
        {enlarged && card ? (
          <View style={[e.sheet, e.enlarged, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
            {preview(Math.min(wh - insets.top - insets.bottom - 24 - 34, ww * 16 / 9), true)}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

// The activity share pop-up's styles (ActivityDiaryViewer cardSheet), so the
// two read as one thing.
const e = StyleSheet.create({
  enlarged: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  // The activity share's corner button (ActivityDiaryViewer enlargeBtn).
  enlargeBtn: {
    position: 'absolute', top: 10, right: 10, width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.10)',
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' } as any : {}),
  },
  sheet: {
    flex: 1, backgroundColor: RivalGhost.ground,
    ...(webFx({ backgroundImage: 'radial-gradient(ellipse 80% 260px at 50% 0%, rgba(217,119,87,0.16), rgba(217,119,87,0) 70%)', backgroundRepeat: 'no-repeat' })),
  },
  content: { alignItems: 'center', gap: 14, paddingHorizontal: 20, minHeight: '100%' as any, justifyContent: 'center' },
  cardPreview: { aspectRatio: 9 / 16, borderRadius: 18 },
  placeholder: { backgroundColor: 'rgba(255,209,190,0.05)' },
  hintSpace: { fontSize: 12, marginTop: 8, textAlign: 'center', opacity: 0 },
  wrap: { alignSelf: 'stretch', gap: 8, borderRadius: 16, borderWidth: 1, borderColor: RivalGhost.border, backgroundColor: RivalGhost.fill, padding: 12, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hint: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' },
  seg: { flexDirection: 'row', borderWidth: 1, borderColor: RivalGhost.border, borderRadius: 999, padding: 2 },
  segOpt: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  segOptOn: { backgroundColor: RivalGhost.fillOn },
  segText: { fontSize: 10.5, fontWeight: '800', color: 'rgba(255,255,255,0.5)' },
  segTextOn: { color: RivalColors.accentText },
  strip: { flexGrow: 0, alignSelf: 'stretch' },
  row: { gap: 8, paddingRight: 30 },
  choice: { width: 52, height: 72, borderRadius: 10, overflow: 'hidden', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.12)' },
  choiceStamp: { backgroundColor: 'rgba(255,209,190,0.06)', alignItems: 'center', justifyContent: 'center', padding: 4 },
  choiceStampImg: { width: '100%', height: '100%' },
  choiceOn: { borderColor: '#ffb59e' },
  choiceEvent: { backgroundColor: 'rgba(244,234,216,0.09)', borderColor: 'rgba(244,234,216,0.3)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, paddingTop: 4, paddingBottom: 5 },
  choiceEventImg: { width: '100%', flex: 1 },
  choiceEventLabel: { fontSize: 7.5, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.event },
  choiceEventLabelDark: { color: '#4a3c28' },
  choiceDark: { backgroundColor: 'rgba(244,234,216,0.82)' },
  fade: {
    position: 'absolute', top: 0, bottom: 0, right: 0, width: 36,
    ...(webFx({ backgroundImage: 'linear-gradient(90deg, rgba(46,42,40,0), rgb(46,42,40))' })),
  },
  card: { alignSelf: 'stretch', borderRadius: 16, borderWidth: 1, borderColor: RivalGhost.border, backgroundColor: RivalGhost.fill, padding: 12 },
  shareBtn: {
    alignSelf: 'stretch', minHeight: 54, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient,
  },
  shareText: { fontSize: 16.5, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill) },
  link: { fontSize: 13.5, fontWeight: '700', color: RivalColors.accentText, marginTop: -4 },
  error: { fontSize: 12.5, color: '#ff8f8f', marginTop: 8, textAlign: 'center' },
  back: { position: 'absolute', left: 16 },
});
