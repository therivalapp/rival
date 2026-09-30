import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { BREAKPOINT_WIDE_LAYOUT } from '../../../constants/breakpoints';
import { supabase } from '../../../lib/supabase';
import { RivalColors } from '../../../constants/rivalTheme';
import { RivalIcon } from '../RivalIcon';
import { sheet } from './sheetStyles';
import { BusyText } from '../BusyText';
import { GreySheet, GreyLabel, GreyRows, GreyRow, GreyField, GreyNote, GreyPrimary } from '../RivalGreySheet';

// Send a teammate a word of encouragement. Ported from the old team page,
// where it hung off each feed post. The send-encouragement function enforces
// one per teammate per day (HTTP 429), and a push goes to the recipient.
//
// Presets are plain text — RIVAL uses real icons, not emoji, in its own copy.
const PRESETS = ["You've got this", 'Keep showing up', 'Proud of you', 'Go get it', "Let's go"];

/** Teammates you've already encouraged today (UTC day, matching the server cap). */
export async function loadEncouragedToday(fromUserId: string): Promise<Set<string>> {
  if (!fromUserId) return new Set();
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { data } = await supabase
    .from('encouragements')
    .select('to_user_id')
    .eq('from_user_id', fromUserId)
    .gte('created_at', start.toISOString());
  return new Set((data || []).map((r: any) => r.to_user_id as string));
}

export function EncourageSheet({
  visible, toUser, onClose, onSent,
}: {
  visible: boolean;
  toUser: { id: string; name: string } | null;
  onClose: () => void;
  /** Called once the teammate can't be encouraged again today — sent, or already sent. */
  onSent: (toUserId: string) => void;
}) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (visible) { setMessage(''); setError(''); } }, [visible]);

  async function send() {
    const text = message.trim();
    if (!toUser || !text || sending) return;
    setSending(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('Sign in again to send this.'); return; }
      const res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/send-encouragement`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({ toUserId: toUser.id, message: text }),
      });
      if (res.status === 429) {
        onSent(toUser.id);
        setError(`${toUser.name} has already been encouraged today.`);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || "Couldn't send that. Try again shortly."); return; }
      onSent(toUser.id);
      onClose();
    } catch {
      setError('Check your connection and try again.');
    } finally {
      setSending(false);
    }
  }

  const canSend = !!message.trim() && !sending;

  const phoneSheet = useWindowDimensions().width < BREAKPOINT_WIDE_LAYOUT;
  // Phone: the grey pop-up. Ready messages as one-line rows (tiles wrapped
  // them onto two lines), your own words below, Send pinned.
  if (phoneSheet) {
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={sheet.backdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} accessibilityLabel="Close" />
          <GreySheet
            kicker="ENCOURAGE"
            title={`Encourage ${toUser?.name ?? ''}`}
            onClose={onClose}
            footer={<GreyPrimary label={sending ? 'Sending…' : 'Send'} busy={sending} disabled={!canSend} onPress={send} />}
          >
            <GreyNote>Sent as a notification. One per teammate per day.</GreyNote>
            <GreyLabel>Suggested</GreyLabel>
            <GreyRows>
              {PRESETS.map((p) => (
                <GreyRow key={p} icon="respect" label={p} onPress={() => setMessage(p)}>
                  {message === p ? <RivalIcon name="check" size={17} color={RivalColors.accentText} /> : null}
                </GreyRow>
              ))}
            </GreyRows>
            <GreyLabel>Or your own words</GreyLabel>
            <GreyField
              value={PRESETS.includes(message) ? '' : message}
              onChangeText={(v) => setMessage(v.slice(0, 140))}
              placeholder="Message"
            />
            {!!error && <Text style={sheet.error}>{error}</Text>}
          </GreySheet>
        </View>
      </Modal>
    );
  }
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={sheet.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={sheet.card}>
          <View style={sheet.grabber} />
          <View style={sheet.head}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={sheet.title}>Encourage {toUser?.name ?? ''}</Text>
              <Text style={sheet.sub}>Sent as a notification. One per teammate per day.</Text>
            </View>
            {/* Phone pop-ups close by tapping outside, no X. */}
            {!phoneSheet && (
              <TouchableOpacity style={sheet.close} onPress={onClose} accessibilityLabel="Close">
                <RivalIcon name="close" size={18} color={RivalColors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          <Text style={sheet.label}>Suggested messages</Text>
          <View style={sheet.chipRow}>
            {PRESETS.map(p => (
              <TouchableOpacity key={p} style={[sheet.chip, message === p && sheet.chipOn]} onPress={() => setMessage(p)}>
                <Text style={[sheet.chipText, message === p && sheet.chipTextOn]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={sheet.label}>Custom message</Text>
          <TextInput
            style={sheet.input}
            value={message}
            onChangeText={(v) => setMessage(v.slice(0, 140))}
            placeholder="Message"
            placeholderTextColor={RivalColors.textSecondary}
          />
          {!!error && <Text style={sheet.error}>{error}</Text>}

          <View style={sheet.btnRow}>
            <TouchableOpacity style={sheet.secondaryBtn} onPress={onClose}>
              <Text style={sheet.secondaryBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[sheet.primaryBtn, !canSend && sheet.primaryBtnOff]} onPress={send} disabled={!canSend}>
              <BusyText busy={!!(sending)} style={sheet.primaryBtnText}>{sending ? 'Sending…' : 'Send'}</BusyText>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
