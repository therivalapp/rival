import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { confirmAction, notify } from '../../lib/notify';
import { displayToIsoDate, isoToDisplayDate, friendlyDate, friendlyTime } from '../../lib/dateFormat';
import { RivalColors, RivalSerifFamily, RivalButtonColors, RivalGhost } from '../../constants/rivalTheme';
import { RivalIcon, activityIconName } from './RivalIcon';
import { RivalCalendarGrid } from './RivalCalendarGrid';
import { BusyText } from './BusyText';
import { BREAKPOINT_WIDE_LAYOUT, sidePageWide, SIDE_SHEET_MAX_WIDTH } from '../../constants/breakpoints';

// Planning a meet-up, in one sheet, from anywhere.
//
// This used to exist only as a block inside league.tsx's Chat tab. When that
// tab was removed the only remaining way to plan a session was the Sessions
// tab — which is not where you are when the idea comes up. You're in the
// conversation ("anyone free Saturday?"), or looking at the team's Overview.
// So the composer became a component and both of those got a button, rather
// than each screen growing its own copy of the same form to drift out of sync.
//
// Sessions are just league_messages with kind:'session' — same table as chat,
// so a planned session lands in the conversation as its own card. That's the
// whole point: the plan and the talk about the plan live together.

const SESSION_TYPES = ['Run', 'Ride', 'Swim', 'CrossFit', 'Hike', 'WeightTraining', 'Workout'];
// Sentinel for the chip that reveals a free-text field. Not a real type — the
// typed value is what gets stored. Sessions aren't scored, so this text never
// reaches scoring_config and can't fork a multiplier row the way an
// un-normalised imported activity_type would.
const CUSTOM = '__custom__';
// Phones plan everything through Date and Time; Train Now stored exactly what
// Schedule does, so the toggle is hidden there. Kept for desktop and in case
// it comes back.
const SHOW_TRAIN_NOW_ON_PHONE = false;
// Short names so every tile label fits on one line.
const TILE_LABELS: Record<string, string> = { CrossFit: 'CrossFit', WeightTraining: 'Weights' };

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

// Wheel geometry. ROW must divide WHEEL_H into an odd number of rows so one
// row sits dead centre with the same count above and below it.
const ROW = 40;
const WHEEL_H = ROW * 5;
const WHEEL_PAD = (WHEEL_H - ROW) / 2;

// One column of an iOS-style picker: a fixed, clipped frame with a scroll
// track inside it that snaps a row at a time.
//
// The frame's height MUST be explicit. The first attempt at this put the
// columns in a row with alignItems:'center', which sizes children to their
// content rather than stretching them — so each ScrollView took its full
// content height and rendered straight through the card and off the screen.
function Wheel({
  values, value, onChange, open,
}: {
  values: string[];
  value: string;
  onChange: (v: string) => void;
  open: boolean;
}) {
  const ref = useRef<ScrollView>(null);
  const index = Math.max(0, values.indexOf(value));

  // Line the current value up under the band each time the picker opens —
  // otherwise it opens at the top showing 00 while the row behind it says 07.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => ref.current?.scrollTo({ y: index * ROW, animated: false }), 0);
    return () => clearTimeout(t);
  }, [open, index]);

  function settle(y: number) {
    const i = Math.min(values.length - 1, Math.max(0, Math.round(y / ROW)));
    if (values[i] !== value) onChange(values[i]);
  }

  return (
    <ScrollView
      ref={ref}
      style={styles.wheel}
      contentContainerStyle={{ paddingVertical: WHEEL_PAD }}
      showsVerticalScrollIndicator={false}
      snapToInterval={ROW}
      decelerationRate="fast"
      scrollEventThrottle={16}
      // Both, deliberately: react-native-web only synthesises momentum-end
      // from an idle timer, and a slow drag can settle without ever firing it.
      onScroll={(e) => settle(e.nativeEvent.contentOffset.y)}
      onMomentumScrollEnd={(e) => settle(e.nativeEvent.contentOffset.y)}
    >
      {values.map((v) => (
        <TouchableOpacity
          key={v}
          style={styles.wheelCell}
          onPress={() => { onChange(v); ref.current?.scrollTo({ y: values.indexOf(v) * ROW, animated: true }); }}
        >
          <Text style={[styles.wheelText, v === value && styles.wheelTextOn]}>{v}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// "WeightTraining" is how the database spells it, and how it has to stay —
// scoring_config is keyed on the exact string. Only the label gets spaced out.
function typeLabel(t: string): string {
  return t.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

function todayDisplay(): string {
  const d = new Date();
  return isoToDisplayDate(
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
  );
}

/** An existing session being edited, rather than a new one being planned. */
export type EditableSession = {
  id: string;
  activity_type: string | null;
  body: string | null;
  scheduled_at: string | null;
  location: string | null;
};

export function PlanSessionSheet({
  visible,
  leagueId,
  currentUserId,
  onClose,
  onPosted,
  editing,
}: {
  visible: boolean;
  leagueId: string;
  currentUserId: string | null;
  onClose: () => void;
  /** Fires after a successful post, edit or cancellation. */
  onPosted?: () => void;
  /** Pass a session to edit it in place; omit to plan a new one. */
  editing?: EditableSession | null;
}) {
  const [type, setType] = useState('Run');
  const [customType, setCustomType] = useState('');
  const [date, setDate] = useState(todayDisplay());
  const [time, setTime] = useState('07:00');
  // Minutes from now for a "Train Now" session, or null for a scheduled one.
  // Replaces the old team page's separate Let's Train form: same thing, one
  // switch inside the sheet rather than a second button competing for room.
  const [startsIn, setStartsIn] = useState<number | null>(null);
  // Train Now with a set clock time instead of "in N min". Today only: a
  // later day is what Schedule is for.
  const [nowAt, setNowAt] = useState<string | null>(null);
  // Which value the time wheel is editing.
  const [timeFor, setTimeFor] = useState<'plan' | 'now'>('plan');
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [posting, setPosting] = useState(false);
  // The seven chips are the common cases, not the whole set — RIVAL scores 65
  // sports. This is the way to the rest, loaded from scoring_config so the
  // list can never drift from what the app actually knows how to score.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [allTypes, setAllTypes] = useState<string[]>([]);
  const [typeSearch, setTypeSearch] = useState('');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const wheelTime = timeFor === 'now' && nowAt ? nowAt : time;
  const setWheelTime = (v: string) => (timeFor === 'now' ? setNowAt(v) : setTime(v));
  const [hh, mm] = [wheelTime.split(':')[0] ?? '07', wheelTime.split(':')[1] ?? '00'];
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  // Phones get the tile grid and centred title; desktop keeps the chips.
  const m = !sidePageWide(windowWidth);
  // On a wide screen the sheet is a centred dialog, like the other pop-ups.
  const dialog = windowWidth >= BREAKPOINT_WIDE_LAYOUT;

  // Load the session being edited into the form. Keyed on the row's id rather
  // than the object, so a refetch that returns an equal-but-new object can't
  // wipe out edits the user has already typed.
  useEffect(() => {
    if (!visible) return;
    if (editing) {
      const when = editing.scheduled_at ? new Date(editing.scheduled_at) : null;
      setType(editing.activity_type ?? 'Run');
      setCustomType('');
      setDate(when
        ? isoToDisplayDate(`${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`)
        : todayDisplay());
      setTime(when ? `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}` : '07:00');
      setLocation(editing.location ?? '');
      setNote(editing.body ?? '');
    } else {
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editing?.id]);

  useEffect(() => {
    if (!pickerOpen || allTypes.length > 0) return;
    supabase.from('scoring_config').select('activity_type').then(({ data }) => {
      setAllTypes(
        (data ?? [])
          .map((r: any) => r.activity_type as string)
          .sort((a, b) => a.localeCompare(b)),
      );
    });
  }, [pickerOpen, allTypes.length]);

  function reset() {
    setType('Run');
    setCustomType('');
    // Phone: start at the next quarter hour, so planning a session for right
    // now takes no extra taps. Desktop keeps 07:00.
    if (m) {
      const d = new Date(Date.now() + 15 * 60 * 1000);
      d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
      setDate(isoToDisplayDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`));
      setTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    } else {
      setDate(todayDisplay());
      setTime('07:00');
    }
    setStartsIn(null);
    setNowAt(null);
    setLocation('');
    setNote('');
  }

  const resolvedType = type === CUSTOM ? customType.trim() : type;

  // What/when/where. A session missing any of them isn't something a teammate
  // can act on — "Run, sometime, somewhere" gives them nothing to say yes to —
  // so the post button stays inert until all four are answered. Additional
  // information is the one field that genuinely is optional.
  const parsedTime = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  const timeValid = !!parsedTime
    && Number(parsedTime[1]) >= 0 && Number(parsedTime[1]) <= 23
    && Number(parsedTime[2]) >= 0 && Number(parsedTime[2]) <= 59;
  // True when the chosen activity isn't one of the seven quick chips — either
  // picked from the full list or typed as a custom one.
  const outsidePick = type === CUSTOM || !SESSION_TYPES.includes(type);

  const whenValid = startsIn !== null || (!!displayToIsoDate(date) && timeValid);
  const canPost = !!resolvedType && whenValid && !!location.trim();

  // Opens the time wheel for a Train Now start, beginning at the next quarter
  // hour so the first value shown is always later today.
  function nextQuarterHour(): string {
    const d = new Date(Date.now() + 15 * 60 * 1000);
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function pickNowTime() {
    if (!nowAt) setNowAt(nextQuarterHour());
    setTimeFor('now');
    setTimeOpen(true);
  }

  function nowStartLabel(): string {
    if (nowAt) return friendlyTime(nowAt);
    const d = new Date(Date.now() + (startsIn ?? 0) * 60 * 1000);
    return friendlyTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
  }

  async function post() {
    if (!currentUserId || posting || !canPost) return;
    if (!resolvedType) {
      notify('Activity needed', 'Choose an activity or enter a custom name.');
      return;
    }
    let scheduledAt: Date;
    if (startsIn !== null && nowAt) {
      const [h, min] = nowAt.split(':').map(Number);
      const now = new Date();
      scheduledAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, min);
      if (scheduledAt.getTime() <= now.getTime()) {
        notify('Pick a later time', 'Train Now is for later today. To plan another day, use Schedule.');
        return;
      }
    } else if (startsIn !== null) {
      scheduledAt = new Date(Date.now() + startsIn * 60 * 1000);
    } else {
      const isoDate = displayToIsoDate(date);
      const [h, min] = time.split(':').map(Number);
      // Number('3O') is NaN and NaN == null is false, so an explicit range check
      // is the only guard that keeps an Invalid Date out of toISOString() below.
      if (!isoDate || !Number.isInteger(h) || !Number.isInteger(min) || h < 0 || h > 23 || min < 0 || min > 59) {
        notify('Check the time', 'Enter the time in 24-hour format, for example 07:30.');
        return;
      }
      const [y, m, d] = isoDate.split('-').map(Number);
      scheduledAt = new Date(y, m - 1, d, h, min);
    }

    setPosting(true);

    const fields = {
      activity_type: resolvedType,
      scheduled_at: scheduledAt.toISOString(),
      location: location.trim() || null,
      body: note.trim() || null,
    };

    // Editing updates in place rather than delete-and-repost, which would drop
    // every RSVP on the session along with it.
    if (editing) {
      const { error: updErr } = await supabase
        .from('league_messages')
        .update(fields)
        .eq('id', editing.id);
      setPosting(false);
      if (updErr) {
        notify("Couldn't save those changes", updErr.message);
        return;
      }
      onPosted?.();
      onClose();
      return;
    }

    const { data: inserted, error } = await supabase.from('league_messages').insert({
      league_id: leagueId,
      user_id: currentUserId,
      kind: 'session',
      ...fields,
    }).select('id').single();

    if (error || !inserted) {
      setPosting(false);
      notify("Couldn't plan that activity", error?.message || 'Try again.');
      return;
    }

    // Whoever planned it is going. Non-fatal if it fails — the session exists,
    // and they can tap "I'm in" like anyone else.
    const { error: rsvpErr } = await supabase
      .from('league_session_rsvps')
      .insert({ message_id: inserted.id, user_id: currentUserId });
    if (rsvpErr) console.error('Creator auto-RSVP failed:', rsvpErr.message);

    // Tell the team. Fire-and-forget: a session nobody was notified about is
    // still a session, and a failed notification must not fail the post.
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/session-invite-notifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({ messageId: inserted.id }),
      }).catch(() => {});
    }

    setPosting(false);
    reset();
    onPosted?.();
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Tapping the dimmed area closes, the way a sheet should. Its own
            View rather than wrapping the card, so a tap inside the form
            can't bubble out and dismiss what you're filling in. */}
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        {/* The form is sized to fit — it should never scroll on a phone. The
            cap exists only so a genuinely short viewport (landscape, or a small
            device with the keyboard up) degrades to scrolling instead of
            pushing the post button off-screen. */}
        <View style={[styles.sheet, dialog && styles.sheetDialog, { maxHeight: windowHeight * (dialog ? 0.86 : 0.92) }]}>
          {/* Warm glow bleeding down from the top edge. The sheet was one flat
              tone end to end, so nothing said "this is the top" — a light
              source does that without adding a single line of chrome. */}
          <View style={styles.glow} pointerEvents="none" />
          {dialog ? null : <View style={styles.grabber} />}

          {m ? (
            // Centred kicker and serif title, the Edit team challenge header.
            <View style={styles.mHead}>
              <Text style={[styles.kicker, styles.mCenter]}>TEAM ACTIVITY</Text>
              <Text style={[styles.title, styles.mTitle]}>{editing ? 'Edit activity' : 'Plan an activity'}</Text>
            </View>
          ) : (
            <View style={styles.head}>
              <View style={styles.headIcon}>
                <RivalIcon name="calendar" size={17} color={RivalColors.accentText} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.kicker}>TEAM ACTIVITY</Text>
                <Text style={styles.title}>{editing ? 'Edit Activity' : 'Plan an Activity'}</Text>
              </View>
              <TouchableOpacity onPress={onClose} accessibilityLabel="Cancel" style={styles.closeBtn}>
                <RivalIcon name="close" size={18} color={RivalColors.textSecondary} />
              </TouchableOpacity>
            </View>
          )}

          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={styles.formScroll}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.label}>Activity</Text>
            {/* No icons on the chips. At 13px several of the seven resolve to
                the same generic dumbbell, so they stopped telling you anything
                and just added texture to an already busy block. They stay in
                the picker, where the rows are tall enough for them to read. */}
            {m ? (
              // Seven tiles with round icon badges plus See all, four to a row.
              // The eighth tile also shows a pick made outside the seven.
              <View style={styles.tiles}>
                {SESSION_TYPES.map((t) => {
                  const on = type === t;
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[styles.tile, m && pg.tile, on && styles.tileOn, m && on && pg.tileOn]}
                      onPress={() => setType(t)}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <View style={[styles.badge, on && styles.badgeOn]}>
                        <RivalIcon name={activityIconName(t)} size={16} color={on ? RivalColors.surfaceLowest : 'rgba(255,255,255,0.6)'} />
                      </View>
                      <Text style={[styles.tileText, on && styles.tileTextOn]} numberOfLines={1}>{TILE_LABELS[t] ?? typeLabel(t)}</Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  style={[styles.tile, m && pg.tile, outsidePick ? [styles.tileOn, m && pg.tileOn] : styles.tileAll]}
                  onPress={() => setPickerOpen(true)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                >
                  <View style={[styles.badge, outsidePick ? styles.badgeOn : styles.badgeAll]}>
                    <RivalIcon
                      name={outsidePick && type !== CUSTOM ? activityIconName(type) : type === CUSTOM ? 'edit' : 'apps'}
                      size={16}
                      color={outsidePick ? RivalColors.surfaceLowest : RivalColors.accentText}
                    />
                  </View>
                  <Text style={[styles.tileText, outsidePick ? styles.tileTextOn : styles.tileAllText]} numberOfLines={1}>
                    {type === CUSTOM ? 'Custom' : outsidePick ? typeLabel(type) : 'See all'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.chipRow}>
                {SESSION_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.chip, type === t && styles.chipOn]}
                    onPress={() => setType(t)}
                  >
                    <Text style={[styles.chipText, type === t && styles.chipTextOn]}>{typeLabel(t)}</Text>
                  </TouchableOpacity>
                ))}
                {/* ONE trailing action, not two. It also doubles as the display
                    for a pick made outside the seven — filled with that activity's
                    name — so choosing "Badminton" doesn't inject an eighth chip
                    and reflow the whole block. */}
                <TouchableOpacity
                  style={[styles.chip, outsidePick ? styles.chipOn : styles.chipMore]}
                  onPress={() => setPickerOpen(true)}
                >
                  <Text style={[styles.chipText, outsidePick ? styles.chipTextOn : styles.chipMoreText]}>
                    {type === CUSTOM ? 'Custom Activity' : outsidePick ? typeLabel(type) : 'See all'}
                  </Text>
                  <RivalIcon
                    name="chevronRight"
                    size={13}
                    color={outsidePick ? RivalColors.surfaceLowest : RivalColors.accentText}
                  />
                </TouchableOpacity>
              </View>
            )}
            {/* Built as a row in the same recessed card the details use, not a
                loose full-width box. It appeared mid-form in a shape nothing
                else on the sheet had, so it read as bolted on rather than as
                the Custom chip's own field. */}
            {type === CUSTOM && (
              <View style={[styles.fieldCard, m && pg.fieldCard, styles.customCard]}>
                {/* A plain left-aligned field, not a label/value row. The
                    Details card below is a value LIST — label left, value
                    right — which only works when there's a value sitting on
                    the right to balance the label. With one empty text field
                    that layout put the word "Title" at one end and the caret
                    at the other, with a hand-span of nothing between them. */}
                <TextInput
                  style={styles.customInput}
                  value={customType}
                  onChangeText={setCustomType}
                  placeholder="Title"
                  placeholderTextColor={RivalColors.textSecondary}
                  autoFocus
                />
              </View>
            )}

            {/* One grouped card with hairline dividers instead of four
                free-floating boxes. Each field is a labelled ROW, so the sheet
                reads as a single form rather than a stack of identical
                rectangles — and every row gets its own accent icon, which is
                what makes it scannable at a glance. */}
            {!editing && (!m || SHOW_TRAIN_NOW_ON_PHONE) && (
              <>
                <Text style={styles.label}>When</Text>
                <View style={[styles.whenRow, m && pg.fieldCard]}>
                  <TouchableOpacity style={[styles.whenBtn, startsIn === null && styles.whenBtnOn]} onPress={() => { setStartsIn(null); setNowAt(null); }}>
                    <Text style={[styles.whenText, startsIn === null && styles.whenTextOn]}>Schedule</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.whenBtn, startsIn !== null && styles.whenBtnOn]} onPress={() => { setStartsIn(v => v ?? 30); if (m && !nowAt) setNowAt(nextQuarterHour()); }}>
                    <Text style={[styles.whenText, startsIn !== null && styles.whenTextOn]}>Train Now</Text>
                  </TouchableOpacity>
                </View>
                {startsIn !== null && !m && (
                  <View style={[styles.chipRow, { marginTop: 10 }]}>
                    {[15, 30, 60, 90].map(v => (
                      <TouchableOpacity key={v} style={[styles.chip, !nowAt && startsIn === v && styles.chipOn]} onPress={() => { setNowAt(null); setStartsIn(v); }}>
                        <Text style={[styles.chipText, !nowAt && startsIn === v && styles.chipTextOn]}>In {v} min</Text>
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity style={[styles.chip, !!nowAt && styles.chipOn]} onPress={pickNowTime}>
                      <Text style={[styles.chipText, !!nowAt && styles.chipTextOn]}>{nowAt ? `At ${nowAt}` : 'Set time'}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}

            <Text style={styles.label}>Details</Text>
            <View style={[styles.fieldCard, m && pg.fieldCard]}>
              {startsIn !== null && m && (
                <>
                  {/* Train Now on a phone: one start time, today only. */}
                  <TouchableOpacity style={styles.fieldRow} onPress={pickNowTime}>
                    <RivalIcon name="schedule" size={16} color={RivalColors.accentText} style={styles.fieldIcon} />
                    <Text style={styles.fieldLabel}>Time</Text>
                    <View style={styles.fieldControl}>
                      <Text style={[styles.rowValue, styles.mValue]}>Today, {nowStartLabel()}</Text>
                    </View>
                  </TouchableOpacity>
                  <View style={styles.divider} />
                </>
              )}
              {startsIn === null && (
                <>
              {/* The whole row is the trigger — no trailing calendar button.
                  A button parked on the right pushed the date 48px in from the
                  card's edge while every other value sat flush against it, so
                  the column didn't line up. Tapping the row opens the calendar,
                  which is fewer taps than typing a date anyway, and removes a
                  text input (one less place iOS raises its accessory bar). */}
              <TouchableOpacity style={styles.fieldRow} onPress={() => setCalendarOpen(true)}>
                <RivalIcon name="calendar" size={16} color={RivalColors.accentText} style={styles.fieldIcon} />
                <Text style={styles.fieldLabel}>Date</Text>
                <View style={styles.fieldControl}>
                  <Text style={[styles.rowValue, m && styles.mValue]}>{m ? friendlyDate(date) : date}</Text>
                </View>
              </TouchableOpacity>

              <View style={styles.divider} />

              {/* Picked, not typed. A pre-filled text field makes you delete
                  "07:00" before you can enter anything, and a free text field
                  accepts "7pm" and "25:70". Tapping picks the hour and minute
                  directly, matching the Date row above it. */}
              <TouchableOpacity style={styles.fieldRow} onPress={() => { setTimeFor('plan'); setTimeOpen(true); }}>
                <RivalIcon name="schedule" size={16} color={RivalColors.accentText} style={styles.fieldIcon} />
                <Text style={styles.fieldLabel}>Time</Text>
                <View style={styles.fieldControl}>
                  <Text style={[styles.rowValue, m && styles.mValue]}>{m ? friendlyTime(time) : time}</Text>
                </View>
              </TouchableOpacity>

              <View style={styles.divider} />
                </>
              )}

              <View style={styles.fieldRow}>
                <RivalIcon name="location" size={16} color={RivalColors.accentText} style={styles.fieldIcon} />
                <Text style={styles.fieldLabel}>Location</Text>
                <View style={styles.fieldControl}>
                  <TextInput
                    style={[styles.rowInput, m && styles.mValue]}
                    value={location}
                    onChangeText={setLocation}
                    placeholder={m ? 'Required' : undefined}
                    // The label beside it already says "Location" — repeating
                    // that here is dead text. The one thing a placeholder can
                    // usefully say in a labelled row is whether the field has
                    // to be filled in, and this one doesn't.
                    placeholderTextColor={m ? 'rgba(255,255,255,0.28)' : RivalColors.textSecondary}
                  />
                </View>
              </View>

              <View style={styles.divider} />

              <View style={styles.fieldRow}>
                <RivalIcon name="manual" size={16} color={RivalColors.accentText} style={styles.fieldIcon} />
                <Text style={styles.fieldLabel}>Notes</Text>
                <View style={styles.fieldControl}>
                  <TextInput
                    style={[styles.rowInput, m && styles.mValue]}
                    value={note}
                    onChangeText={setNote}
                    placeholder={m ? 'Optional' : undefined}
                    placeholderTextColor={m ? 'rgba(255,255,255,0.28)' : RivalColors.textSecondary}
                  />
                </View>
              </View>
            </View>
          </ScrollView>

          <TouchableOpacity
            style={[styles.postBtn, (posting || !canPost) && styles.postBtnOff]}
            onPress={post}
            disabled={posting || !canPost}
          >
            <BusyText busy={posting} style={styles.postBtnText}>
              {posting ? 'Saving…' : editing ? 'Save changes' : 'Post to team'}
            </BusyText>
          </TouchableOpacity>

          {/* Cancelling is destructive and permanent, so it sits apart from the
              primary action and reads as text, not a second button competing
              with Save. */}
          {editing && (
            <TouchableOpacity
              style={styles.cancelBtn}
              disabled={deleting}
              onPress={async () => {
                const ok = await confirmAction({
                  title: 'Cancel this activity?',
                  message: 'It will be removed for the whole team, along with all RSVPs.',
                  confirmLabel: 'Cancel activity',
                  cancelLabel: 'Keep it',
                  destructive: true,
                });
                if (!ok) return;
                setDeleting(true);
                const { error } = await supabase.from('league_messages').delete().eq('id', editing.id);
                setDeleting(false);
                if (error) {
                  notify("Couldn't cancel that activity", error.message);
                  return;
                }
                onPosted?.();
                onClose();
              }}
            >
              <BusyText busy={deleting} style={styles.cancelBtnText}>
                {deleting ? 'Cancelling…' : 'Cancel this activity'}
              </BusyText>
            </TouchableOpacity>
          )}

          {timeOpen && (
            <View style={styles.calendarOverlay}>
              <TouchableOpacity
                style={StyleSheet.absoluteFill}
                activeOpacity={1}
                onPress={() => setTimeOpen(false)}
              />
              <View style={[styles.calendarCard, styles.timeCard]}>
                <Text style={styles.timeTitle}>Start time</Text>

                <View style={styles.wheelRow}>
                  {/* The tinted band marks the selected row. It sits BEHIND the
                      wheels and ignores touches, so a tap still lands on the
                      number under it. */}
                  <View style={styles.wheelBand} pointerEvents="none" />
                  <Wheel values={HOURS} value={hh} onChange={(v) => setWheelTime(`${v}:${mm}`)} open={timeOpen} />
                  <Text style={styles.wheelColon}>:</Text>
                  <Wheel values={MINUTES} value={mm} onChange={(v) => setWheelTime(`${hh}:${v}`)} open={timeOpen} />

                  {/* The signature of an Apple picker: rows don't stop at the
                      frame, they fade into it. A scrim in the card's own colour
                      over the top and bottom thirds does that without having to
                      recompute per-row opacity on every scroll frame. Must not
                      swallow touches. */}
                  <View style={styles.wheelFade} pointerEvents="none" />
                </View>

                <TouchableOpacity style={styles.timeDone} onPress={() => setTimeOpen(false)}>
                  <Text style={styles.timeDoneText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {calendarOpen && (
            <View style={styles.calendarOverlay}>
              <TouchableOpacity
                style={StyleSheet.absoluteFill}
                activeOpacity={1}
                onPress={() => setCalendarOpen(false)}
              />
              <View style={styles.calendarCard}>
                <RivalCalendarGrid
                  value={displayToIsoDate(date) ?? ''}
                  onChange={(nextIso) => { setDate(isoToDisplayDate(nextIso)); setCalendarOpen(false); }}
                />
              </View>
            </View>
          )}

          {/* An overlay inside this same Modal rather than a second Modal —
              stacked modals are unreliable on react-native-web, and this way
              the picker inherits the sheet's exact bounds. */}
          {pickerOpen && (
            <View style={styles.picker}>
              <View style={styles.pickerHead}>
                <TouchableOpacity
                  onPress={() => { setPickerOpen(false); setTypeSearch(''); }}
                  style={styles.closeBtn}
                  accessibilityLabel="Back"
                >
                  <RivalIcon name="back" size={16} color={RivalColors.textSecondary} />
                </TouchableOpacity>
                <Text style={styles.pickerTitle}>All Activities</Text>
              </View>

              <TextInput
                style={[styles.search, m && pg.fieldCard]}
                value={typeSearch}
                onChangeText={setTypeSearch}
                placeholder="Search"
                placeholderTextColor={RivalColors.textSecondary}
                autoCorrect={false}
                autoCapitalize="none"
              />

              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {/* Sixty-five sports still can't cover what a team actually
                    does — padel, a track meet, a charity walk. A closed list
                    quietly tells people their thing doesn't count. */}
                {!typeSearch.trim() && (
                  <TouchableOpacity
                    style={styles.pickerRow}
                    onPress={() => { setType(CUSTOM); setPickerOpen(false); }}
                  >
                    <RivalIcon name="add" size={17} color={RivalColors.accentText} />
                    <Text style={[styles.pickerRowText, styles.pickerRowTextOn]}>Custom Activity</Text>
                    {type === CUSTOM && <RivalIcon name="check" size={16} color={RivalColors.accentText} />}
                  </TouchableOpacity>
                )}
                {allTypes.length === 0 ? (
                  <Text style={styles.pickerEmpty}>Loading…</Text>
                ) : (() => {
                  // Match against the spaced label too, so typing "weight
                  // training" finds WeightTraining.
                  const q = typeSearch.trim().toLowerCase();
                  const shown = q
                    ? allTypes.filter((t) => typeLabel(t).toLowerCase().includes(q) || t.toLowerCase().includes(q))
                    : allTypes;
                  if (shown.length === 0) {
                    return <Text style={styles.pickerEmpty}>No activity matches "{typeSearch.trim()}".</Text>;
                  }
                  return shown.map((t) => (
                    <TouchableOpacity
                      key={t}
                      style={styles.pickerRow}
                      onPress={() => { setType(t); setPickerOpen(false); setTypeSearch(''); }}
                    >
                      <RivalIcon
                        name={activityIconName(t)}
                        size={17}
                        color={type === t ? RivalColors.accentText : RivalColors.textSecondary}
                      />
                      <Text style={[styles.pickerRowText, type === t && styles.pickerRowTextOn]}>
                        {typeLabel(t)}
                      </Text>
                      {type === t && <RivalIcon name="check" size={16} color={RivalColors.accentText} />}
                    </TouchableOpacity>
                  ));
                })()}
              </ScrollView>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  sheet: {
    // A full step lighter than the app background it sits over, so the sheet
    // itself reads as raised before any of its contents do.
    backgroundColor: RivalColors.surfaceHigh,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 26,
    borderTopWidth: 1, borderColor: RivalColors.surfaceBright,
    overflow: 'hidden',
  },
  sheetDialog: {
    alignSelf: 'center', width: '100%', maxWidth: SIDE_SHEET_MAX_WIDTH,
    marginTop: 'auto', marginBottom: 'auto',
    borderRadius: 22, borderWidth: 1, paddingTop: 22,
  },
  glow: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 150,
    ...(Platform.OS === 'web'
      ? { backgroundImage: 'radial-gradient(ellipse 80% 100% at 50% 0%, rgba(217,119,87,0.20) 0%, rgba(217,119,87,0.07) 45%, rgba(217,119,87,0) 100%)' }
      : { backgroundColor: 'rgba(217,119,87,0.07)' }),
  },
  grabber: {
    width: 38, height: 4, borderRadius: 2, alignSelf: 'center',
    backgroundColor: RivalColors.surfaceBright, marginBottom: 14,
  },

  head: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 4 },
  headIcon: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: `${RivalColors.accentFill}26`,
    borderWidth: 1, borderColor: `${RivalColors.accentFill}55`,
  },
  kicker: { fontSize: 9.5, fontWeight: '800', letterSpacing: 1.3, color: RivalColors.accentText },
  // Serif italic, the same voice the Team Challenge and section headings use —
  // the sheet was the only surface in the app titled in plain sans.
  title: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 20, color: '#fff', marginTop: 1 },
  mHead: { alignItems: 'center', marginBottom: 2, paddingHorizontal: 36 },
  mCenter: { textAlign: 'center' },
  mTitle: { fontSize: 24, textAlign: 'center', marginTop: 3 },
  mClose: { position: 'absolute', right: 0, top: -4 },
  closeBtn: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: RivalColors.surfaceContainer,
  },

  // flexGrow:0 + flexShrink:1 — sizes to its content, and only starts
  // scrolling once the sheet's own maxHeight actually squeezes it.
  formScroll: { flexGrow: 0, flexShrink: 1 },
  label: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: RivalColors.textSecondary, marginTop: 15, marginBottom: 8, textTransform: 'uppercase' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999,
    // Darker than the sheet, not lighter — unselected chips recede, which is
    // what lets a single filled chip read as chosen from across the form.
    backgroundColor: RivalColors.surfaceContainer,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  // Solid accent fill, not an outline. The outline version was a 1px warm ring
  // on the same grey as every other chip — at a glance nothing looked picked.
  chipOn: { backgroundColor: RivalColors.accentText, borderColor: RivalColors.accentText },
  chipText: { fontSize: 12.5, fontWeight: '700', color: RivalColors.textSecondary },
  chipTextOn: { color: RivalColors.surfaceLowest },

  // Warm border rather than the neutral one — it belongs to the accent-filled
  // Custom chip directly above it, and the tint is what says so.
  customCard: { marginTop: 9, borderColor: `${RivalColors.accentFill}55` },
  customInput: {
    color: RivalColors.textPrimary, fontSize: 16, fontWeight: '600',
    paddingVertical: 14, minWidth: 0,
    backgroundColor: 'transparent', borderWidth: 0,
  },

  // Recessed well: darker than the sheet, with a lighter hairline. The old
  // fields were the same tone as the surface behind them, which is why the
  // form read as flat — nothing was in front of anything.
  fieldCard: {
    backgroundColor: RivalColors.surfaceLowest,
    borderRadius: 16,
    borderWidth: 1, borderColor: RivalColors.surfaceBright,
    paddingHorizontal: 13,
  },
  fieldRow: { flexDirection: 'row', alignItems: 'center', minHeight: 46, gap: 10, paddingVertical: 4 },
  fieldIcon: { width: 18, textAlign: 'center' },
  // Every label fits on one line, so all four rows are the same height.
  fieldLabel: { fontSize: 13.5, fontWeight: '600', color: RivalColors.textSecondary, width: 104 },
  // The value side takes the rest of the row and right-aligns, so all four
  // values line up in a column instead of each floating in its own wide box.
  fieldControl: { flex: 1, minWidth: 0, alignItems: 'flex-end' },
  rowInput: {
    color: RivalColors.textPrimary, fontSize: 16, fontWeight: '600',
    textAlign: 'right', paddingVertical: 8, minWidth: 0,
    // No border, no fill — the card is the container. Four bordered boxes
    // inside one bordered box was the dead space.
    backgroundColor: 'transparent', borderWidth: 0,
  },
  // Matches rowInput exactly, so the date sits on the same baseline and the
  // same right edge as the values typed into the rows around it.
  rowValue: { color: RivalColors.textPrimary, fontSize: 16, fontWeight: '600', textAlign: 'right', paddingVertical: 8 },
  // Phone: values a step lighter so they sit with their labels.
  mValue: { fontSize: 15, fontWeight: '500' },
  divider: { height: 1, backgroundColor: RivalColors.surfaceBright, opacity: 0.6 },
  whenRow: {
    flexDirection: 'row', padding: 4, borderRadius: 999,
    backgroundColor: RivalColors.surfaceLowest, borderWidth: 1, borderColor: RivalColors.surfaceBright,
  },
  whenBtn: { flex: 1, minHeight: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  whenBtnOn: { backgroundColor: RivalColors.surfaceBright },
  whenText: { fontSize: 13.5, fontWeight: '700', color: RivalColors.textSecondary },
  whenTextOn: { color: '#fff' },

  calendarOverlay: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 20,
  },
  timeCard: { maxWidth: 320 },
  timeTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 17, color: '#fff', textAlign: 'center', marginBottom: 14 },
  // Explicit height, and NOT alignItems:'center' — that would let each wheel
  // size to its content and spill out of the card.
  wheelRow: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'stretch',
    gap: 2, height: WHEEL_H, marginBottom: 16,
  },
  // Apple's band is a barely-there light wash, not a dark inset well — the
  // numbers stay the subject and the band just says which row counts.
  wheelBand: {
    position: 'absolute', left: 0, right: 0, top: WHEEL_PAD, height: ROW,
    borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.07)',
  },
  wheelFade: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    ...(Platform.OS === 'web'
      ? {
          backgroundImage:
            'linear-gradient(to bottom, #282828 0%, rgba(40,40,40,0.85) 14%, rgba(40,40,40,0) 34%, rgba(40,40,40,0) 66%, rgba(40,40,40,0.85) 86%, #282828 100%)',
        }
      : {}),
  },
  wheel: { width: 68, flexGrow: 0 },
  wheelCell: { height: ROW, alignItems: 'center', justifyContent: 'center' },
  // Every row in white, like Apple's — the fade above is what dims the ones
  // away from centre, so distance does the work instead of two flat colours.
  wheelText: { fontSize: 22, fontWeight: '500', color: '#fff' },
  wheelTextOn: { fontSize: 22, fontWeight: '700', color: '#fff' },
  wheelColon: { fontSize: 22, fontWeight: '600', color: '#fff', alignSelf: 'center', marginBottom: 2 },
  timeDone: {
    marginTop: 2, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderRadius: 999,
    paddingVertical: 12, alignItems: 'center',
  },
  timeDoneText: { fontSize: 14, fontWeight: '800', color: RivalButtonColors.label(RivalColors.surfaceLowest) },

  calendarCard: {
    width: '100%', maxWidth: 340, overflow: 'hidden',
    backgroundColor: RivalColors.surfaceHigh, borderRadius: 18,
    borderWidth: 1, borderColor: RivalColors.surfaceBright, padding: 18,
  },

  postBtn: {
    marginTop: 16, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderRadius: 999,
    paddingVertical: 15, alignItems: 'center',
    ...(Platform.OS === 'web' ? { boxShadow: '0 6px 22px rgba(217,119,87,0.32)' } : {}),
  },
  postBtnOff: { opacity: 0.5 },
  postBtnText: { fontSize: 15, fontWeight: '800', color: RivalButtonColors.label(RivalColors.surfaceLowest), letterSpacing: 0.2 },
  cancelBtn: { paddingVertical: 12, alignItems: 'center' },
  cancelBtnText: { fontSize: 13, fontWeight: '700', color: RivalColors.textSecondary },

  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  tile: {
    width: '23.1%', flexGrow: 1, alignItems: 'center', gap: 6, paddingTop: 10, paddingBottom: 8,
    borderRadius: 14, backgroundColor: RivalColors.surfaceLowest,
    borderWidth: 1, borderColor: 'rgba(255,209,190,0.09)',
  },
  tileOn: { backgroundColor: 'rgba(217,119,87,0.10)', borderColor: 'rgba(255,181,158,0.6)' },
  badge: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  badgeOn: {
    backgroundColor: RivalColors.accentText,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(135deg, #ffb59e, #D97757)' } : {}),
  },
  tileText: { fontSize: 11.5, fontWeight: '600', color: 'rgba(255,255,255,0.72)', maxWidth: '92%' },
  tileTextOn: { color: '#fff' },
  // See all is an action, so it is outlined rather than filled.
  tileAll: { backgroundColor: 'transparent' },
  badgeAll: { backgroundColor: 'transparent', borderWidth: 1, borderStyle: 'dashed', borderColor: `${RivalColors.accentFill}80` },
  tileAllText: { color: RivalColors.accentText },

  // "See all" is an action, not a choice — outlined in the accent rather than
  // filled, so it never looks like a selected activity.
  chipMore: { backgroundColor: 'transparent', borderColor: `${RivalColors.accentFill}66` },
  chipMoreText: { color: RivalColors.accentText },

  picker: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    backgroundColor: RivalColors.surfaceHigh,
    paddingHorizontal: 18, paddingTop: 14, paddingBottom: 20,
  },
  pickerHead: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 12 },
  pickerTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 19, color: '#fff' },
  search: {
    backgroundColor: RivalColors.surfaceLowest, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 11, color: RivalColors.textPrimary,
    fontSize: 16, borderWidth: 1, borderColor: RivalColors.surfaceBright, marginBottom: 8,
  },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: RivalColors.surfaceContainer,
  },
  pickerRowText: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '600', color: RivalColors.textSecondary },
  pickerRowTextOn: { color: '#fff' },
  pickerEmpty: { fontSize: 13, color: RivalColors.textSecondary, textAlign: 'center', paddingVertical: 24 },
});

// Phones: the Add an activity look (warm outlines, Ricky 2026-10-03).
const pg = StyleSheet.create({
  fieldCard: { backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border },
  tile: { backgroundColor: RivalGhost.fill, borderColor: RivalGhost.border },
  tileOn: { backgroundColor: RivalGhost.fillOn, borderColor: RivalGhost.borderOn },
});
