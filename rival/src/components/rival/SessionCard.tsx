import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RivalColors } from '../../constants/rivalTheme';
import { formatAttendees } from '../../lib/attendees';
import { RivalIcon, activityIconName } from './RivalIcon';

// One planned activity, as a card. Shared by the team chat and Team Hub's
// Coming Up so the two can't drift apart — they did once already, when only
// the chat got the redesign.
//
// Presentation only: the screen owns the data and passes in what to do on
// Edit, RSVP and copying the location.

export type SessionCardData = {
  id: string;
  user_id: string;
  activity_type: string | null;
  body: string | null;
  scheduled_at: string | null;
  location: string | null;
};

export function SessionCard({
  session,
  attendeeIds,
  currentUserId,
  nameFor,
  past = false,
  compact = false,
  locationCopied = false,
  onCopyLocation,
  onEdit,
  onToggleRsvp,
}: {
  session: SessionCardData;
  attendeeIds: string[];
  currentUserId: string;
  nameFor: (userId: string) => string;
  past?: boolean;
  /** 20% smaller everywhere — for lists like Team Hub's Coming Up. */
  compact?: boolean;
  locationCopied?: boolean;
  onCopyLocation: () => void;
  onEdit: () => void;
  onToggleRsvp: () => void;
}) {
  const joined = attendeeIds.includes(currentUserId);
  const mine = session.user_id === currentUserId;
  // No line limits anywhere on this card: text wraps rather than ending in
  // "…", so the date, place and who's going are always shown in full.
  // Compact overrides, layered on top of the full-size styles below.
  const c = compact ? compactStyles : null;
  return (
    <View style={[styles.sessionCard, c?.sessionCard, past && styles.sessionCardPast]}>
      <View style={[styles.sessionTop, c?.sessionTop]}>
        {/* The activity's own icon on a warm tile, so a glance says "a run is
            planned" before any text is read. */}
        <View style={[styles.sessionTile, c?.sessionTile, past && styles.sessionTilePast]}>
          <RivalIcon name={activityIconName(session.activity_type)} size={compact ? 24 : 30} color="#1a1411" />
        </View>

        <View style={[styles.sessionInfo, c?.sessionInfo]}>
          <Text style={[styles.sessionKicker, c?.sessionKicker, past && styles.sessionKickerPast]}>
            {(session.activity_type ?? 'Activity').toUpperCase()}
            {past && <Text style={styles.sessionDone}>  ·  COMPLETED</Text>}
          </Text>
          {!!session.scheduled_at && (
            <Text style={[styles.sessionWhen, c?.sessionWhen]}>
              {new Date(session.scheduled_at).toLocaleString(undefined, {
                weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
              })}
            </Text>
          )}
          {!!session.location && (
            // Typed text, not a map pin, so it doesn't pretend to open a map.
            // Tapping copies it for pasting into whatever maps app you use.
            <TouchableOpacity
              onPress={onCopyLocation}
              style={[styles.sessionWhereRow, c?.sessionWhereRow]}
              accessibilityLabel={`Copy location: ${session.location}`}
            >
              <RivalIcon name="location" size={compact ? 12 : 15} color={RivalColors.textSecondary} />
              <Text style={[styles.sessionWhere, c?.sessionWhere]} selectable>{session.location}</Text>
              {locationCopied && <Text style={[styles.sessionCopied, c?.sessionCopied]}>Copied</Text>}
            </TouchableOpacity>
          )}
          {!!session.body && <Text style={[styles.sessionNote, c?.sessionNote]}>{session.body}</Text>}
        </View>

        {/* Only the organiser, and only while it's still ahead. */}
        {!past && mine && (
          <TouchableOpacity style={[styles.sessionEditBtn, c?.sessionEditBtn]} onPress={onEdit} accessibilityLabel="Edit activity">
            <Text style={[styles.sessionEditText, c?.sessionEditText]}>Edit</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={[styles.sessionFoot, c?.sessionFoot]}>
        <Text style={[styles.sessionGoing, c?.sessionGoing]}>
          {past
            ? `${attendeeIds.length} ${attendeeIds.length === 1 ? 'person' : 'people'} attended`
            : formatAttendees(attendeeIds, currentUserId, nameFor)}
        </Text>
        {/* You can't turn up to something that's finished, so a past session
            has no RSVP at all rather than a button that means nothing. */}
        {!past && (
          <TouchableOpacity style={[styles.rsvpBtn, c?.rsvpBtn]} onPress={onToggleRsvp}>
            <Text style={[styles.rsvpText, c?.rsvpText]}>{joined ? "I'm out" : "I'm in"}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Warm-tinted dark card with a hairline in the accent, per the planner card
  // mockup: an event reads as its own object in the thread, not a message.
  sessionCard: {
    backgroundColor: '#1c1a19',
    borderRadius: 20,
    borderWidth: 1, borderColor: `${RivalColors.accentFill}40`,
    padding: 14,
    gap: 14,
  },
  sessionCardPast: { opacity: 0.55, borderColor: RivalColors.outlineVariant },
  sessionTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 13 },
  sessionTile: {
    width: 58, height: 58, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: RivalColors.accentText,
    ...(Platform.OS === 'web'
      ? { backgroundImage: 'linear-gradient(225deg, #FFB86B 0%, #FF8773 100%)' }
      : {}),
  },
  sessionTilePast: { backgroundImage: 'none', backgroundColor: RivalColors.surfaceBright } as any,
  // minWidth 0 so a long location ellipsises instead of pushing Edit off the card.
  sessionInfo: { flex: 1, minWidth: 0, gap: 3 },
  sessionKicker: { fontSize: 11.5, fontWeight: '800', color: RivalColors.accentText, letterSpacing: 2 },
  sessionKickerPast: { color: RivalColors.textSecondary },
  sessionWhen: { fontSize: 18, fontWeight: '800', color: RivalColors.textPrimary, letterSpacing: -0.2 },
  sessionWhereRow: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', maxWidth: '100%' },
  sessionWhere: { fontSize: 14.5, color: RivalColors.textSecondary, flexShrink: 1 },
  sessionCopied: { fontSize: 11, fontWeight: '700', color: RivalColors.accentText, marginLeft: 4 },
  sessionNote: { fontSize: 13.5, color: RivalColors.textSecondary, marginTop: 2 },
  sessionEditBtn: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  sessionEditText: { fontSize: 13, fontWeight: '700', color: RivalColors.textPrimary },
  sessionFoot: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sessionDone: { color: RivalColors.textSecondary },
  sessionGoing: { flex: 1, minWidth: 0, fontSize: 13.5, color: RivalColors.textSecondary },
  // Same warm gradient as the tile, in both states: the label says whether
  // you're in, and "You're going" beside it says it again.
  rsvpBtn: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 999,
    backgroundColor: RivalColors.accentText,
    ...(Platform.OS === 'web'
      ? { backgroundImage: 'linear-gradient(225deg, #FFB86B 0%, #FF8773 100%)' }
      : {}),
  },
  rsvpText: { fontSize: 15, fontWeight: '800', color: '#1a1411' },
});

// Every size above at 80%, rounded to the half pixel.
const compactStyles = StyleSheet.create({
  sessionCard: { borderRadius: 16, padding: 11, gap: 11 },
  sessionTop: { gap: 10 },
  sessionTile: { width: 46, height: 46, borderRadius: 12 },
  sessionInfo: { gap: 2 },
  sessionKicker: { fontSize: 9.5, letterSpacing: 1.6 },
  sessionWhen: { fontSize: 14.5 },
  sessionWhereRow: { gap: 4 },
  sessionWhere: { fontSize: 11.5 },
  sessionCopied: { fontSize: 9 },
  sessionNote: { fontSize: 11 },
  sessionEditBtn: { paddingHorizontal: 11, paddingVertical: 5 },
  sessionEditText: { fontSize: 10.5 },
  sessionFoot: { gap: 8 },
  sessionGoing: { fontSize: 11 },
  rsvpBtn: { paddingHorizontal: 16, paddingVertical: 8 },
  rsvpText: { fontSize: 12 },
});
