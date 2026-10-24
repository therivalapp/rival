import { Platform, StyleSheet, Text, View } from 'react-native';
import { RivalColors, RivalFontFamily, RivalGhost, RivalSerifFamily } from '../../constants/rivalTheme';
import { RivalIcon, type RivalIconName } from './RivalIcon';
import { RespectStar } from './RespectStar';
import { RivalAvatar } from './RivalAvatar';
import { RESPECT_COLOUR } from '../../constants/reactionColours';

/** A past week, compact (Ricky, 2026-10-18): stats only, so the journal
 *  scrolls on into the week's activities. The week named, its seven days with
 *  the active ones lit, the week's Effort large, and one line of totals. */
export function WeekSummaryCard({ kicker, title, event, eventName, days, effort, totals, note }: {
  kicker: string;
  title: string;
  /** An event week: the kicker and event name in ivory. */
  event?: boolean;
  eventName?: string | null;
  /** Monday first: an active day, the event's day, a day with a best. */
  days: ('on' | 'event' | 'best' | null)[];
  effort: number;
  /** Time, distance, activities: tiles across the bottom. */
  totals: { parts: { value: string; unit?: string }[]; label: string }[];
  /** A best (gold), or a line whose leading figure is in salmon. */
  note: { text: string; figure?: string; more?: number; best?: boolean; respect?: boolean; icon?: RivalIconName; people?: { name: string; uri: string | null }[] } | null;
}) {
  const m = note && !note.best ? note.text.match(/^([\d,]+%?)(.*)$/) : null;
  return (
    <View style={s.card}>
      {/* The same warm glow from the top edge as This week (ivory for an event). */}
      <View style={[s.glow, event && s.glowEvent, { pointerEvents: 'none' }]} />
      <View style={s.top}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.kicker, event && { color: RivalColors.event }]} numberOfLines={1}>{kicker}</Text>
          <Text style={[s.title, event && { color: RivalColors.event }]} numberOfLines={1}>{title}</Text>
          {eventName ? <Text style={s.event} numberOfLines={1}>{eventName}</Text> : null}
          <View style={s.days}>
            {days.map((on, i) => (
              <View key={i} style={s.day}>
                <Text style={[s.dayLetter, on && s.dayLetterOn]}>{'MTWTFSS'[i]}</Text>
                <View style={[s.dot, on && s.dotOn, on === 'event' && s.dotEvent, on === 'best' && s.dotBest]} />
              </View>
            ))}
          </View>
        </View>
        <View style={s.effort}>
          <Text style={s.effortNum}>{Math.round(effort).toLocaleString()}</Text>
          <Text style={s.effortLabel}>Effort</Text>
        </View>
      </View>
      <View style={s.foot}>
        <View style={s.tiles}>
          {totals.map((t) => (
            <View key={t.label} style={s.tile}>
              <Text style={s.tileValue} numberOfLines={1}>{t.parts.map((p, i) => <Text key={i}>{i > 0 ? ' ' : ''}{p.value}{p.unit ? <Text style={s.tileUnit}>{p.unit === 'h' || p.unit === 'm' ? '' : ' '}{p.unit}</Text> : null}</Text>)}</Text>
              <Text style={s.tileLabel}>{t.label}</Text>
            </View>
          ))}
        </View>
        {note?.people?.length ? (
          // Who gave Respect, by face and name (Ricky, 2026-10-19, A).
          <View style={s.people}>
            <View style={s.faces}>
              {note.people.slice(0, 3).map((p, i) => (
                <View key={i} style={[s.face, i > 0 && s.faceOverlap]}>
                  {p.uri ? <RivalAvatar uri={p.uri} name={p.name} size={24} /> : (
                    // No photo: warm initials, so it reads as a person.
                    <View style={s.initials}><Text style={s.initialsText}>{p.name.trim().charAt(0).toUpperCase()}</Text></View>
                  )}
                </View>
              ))}
            </View>
            <Text style={s.peopleText} numberOfLines={2}>
              {whoGave(note.people)}
              <Text> gave Respect</Text>
            </Text>
            <View style={{ marginLeft: -3 }}><RespectStar on size={14} onColour={RESPECT_COLOUR} offColour={RESPECT_COLOUR} animate={false} /></View>
          </View>
        ) : note ? (
          <View style={s.note}>
            {note.respect
              // The same star as the Respect button.
              ? <View style={{ marginRight: -1 }}><RespectStar on size={14} onColour={RESPECT_COLOUR} offColour={RESPECT_COLOUR} animate={false} /></View>
              : <RivalIcon name={note.best ? 'trophy' : note.icon ?? 'trendUp'} size={13} color={note.best ? '#ffd27a' : RivalColors.accentText} />}
            {note.best
              ? <Text style={[s.noteText, { color: '#ffd27a' }]} numberOfLines={1}>{note.text}{note.figure ? <Text style={s.noteBestFigure}>{`  ·  ${note.figure}`}</Text> : null}{note.more ? ` and ${note.more} more` : ''}</Text>
              : m
                // Figure and words as siblings, so every gap in the line is the same.
                ? <><Text style={[s.noteText, s.noteFigure]}>{m[1]}</Text><Text style={s.noteText} numberOfLines={1}>{m[2].trim()}</Text></>
                : <Text style={s.noteText} numberOfLines={1}>{note.text}</Text>}
          </View>
        ) : null}
      </View>
    </View>
  );
}

// "Sandy", "Sandy and Marco", "Sandy, Marco and 1 other".
function whoGave(people: { name: string }[]) {
  const b = (n: string, k: number) => <Text key={k} style={s.peopleName}>{n}</Text>;
  if (people.length === 1) return b(people[0].name, 0);
  if (people.length === 2) return <>{b(people[0].name, 0)} and {b(people[1].name, 1)}</>;
  const rest = people.length - 2;
  return <>{b(people[0].name, 0)}, {b(people[1].name, 1)} and {rest} {rest === 1 ? 'other' : 'others'}</>;
}

const s = StyleSheet.create({
  card: {
    position: 'relative', overflow: 'hidden', width: '100%', borderRadius: 22, paddingHorizontal: 18, paddingVertical: 16, gap: 14,
    backgroundColor: RivalGhost.ground, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  glow: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 120,
    ...(Platform.OS === 'web'
      ? { backgroundImage: 'radial-gradient(ellipse 75% 100% at 50% 0%, rgba(232,131,95,0.22), rgba(232,131,95,0) 70%)' } as any
      : { backgroundColor: 'rgba(232,131,95,0.06)' }),
  },
  glowEvent: Platform.OS === 'web'
    ? { backgroundImage: 'radial-gradient(ellipse 75% 100% at 50% 0%, rgba(244,234,216,0.15), rgba(244,234,216,0) 70%)' } as any
    : { backgroundColor: 'rgba(244,234,216,0.05)' },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  kicker: { fontFamily: RivalFontFamily, fontSize: 10, fontWeight: '800', letterSpacing: 1.8, textTransform: 'uppercase', color: '#ffd3c2' },
  title: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 26, lineHeight: 30, color: '#fff', marginTop: 3 },
  event: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 15, lineHeight: 19, color: RivalColors.event, marginTop: 1 },
  days: { flexDirection: 'row', gap: 4, marginTop: 10 },
  day: { width: 20, alignItems: 'center', gap: 4 },
  dayLetter: { fontFamily: RivalFontFamily, fontSize: 9, fontWeight: '800', color: 'rgba(255,255,255,0.45)' },
  dayLetterOn: { color: '#fff' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.16)' },
  dotOn: { backgroundColor: RivalColors.accentFill },
  dotEvent: { backgroundColor: RivalColors.event },
  dotBest: { backgroundColor: '#ffd27a' },
  effort: { alignItems: 'center' },
  effortNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 38, lineHeight: 42, color: '#fff', paddingHorizontal: 2 },
  effortLabel: { fontFamily: RivalFontFamily, fontSize: 9.5, fontWeight: '800', letterSpacing: 1.8, textTransform: 'uppercase', color: RivalColors.accentText, marginTop: -2 },
  foot: { gap: 10 },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, minWidth: 0, alignItems: 'center', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,209,190,0.08)' },
  // A fixed height: a value with a unit beside it otherwise sits taller.
  tileValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 22, lineHeight: 26, height: 26, color: '#fff' },
  tileUnit: { fontFamily: RivalFontFamily, fontStyle: 'normal', fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.55)' },
  tileLabel: { fontFamily: RivalFontFamily, fontSize: 9, fontWeight: '800', letterSpacing: 1.3, textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', marginTop: 2 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  people: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  faces: { flexDirection: 'row' },
  face: { borderRadius: 14, borderWidth: 2, borderColor: RivalGhost.ground },
  faceOverlap: { marginLeft: -9 },
  initials: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(232,131,95,0.28)' },
  initialsText: { fontFamily: RivalFontFamily, fontSize: 11, fontWeight: '800', color: '#ffd3c2' },
  peopleText: { flexShrink: 1, fontFamily: RivalFontFamily, fontSize: 13.5, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },
  peopleName: { color: '#fff', fontWeight: '800' },
  noteText: { fontFamily: RivalFontFamily, fontSize: 13.5, fontWeight: '700', color: '#fff' },
  noteBestFigure: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 15, color: '#ffd27a' },
  noteFigure: { color: RivalColors.accentText, fontWeight: '800' },
});
