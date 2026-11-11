import { useEffect, useState } from 'react';
import { Image, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { usePathname } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Modal } from './RivalModal';
import { GreySheet, GreyLabel, GreyArtTile, GreyArtTiles, GreyNote, GreyPrimary, GreyField } from './RivalGreySheet';
import { RivalIcon } from './RivalIcon';
import { RivalColors, RivalGhost } from '../../constants/rivalTheme';
import { setFeedbackListener, type FeedbackShot } from '../../lib/feedback';
import { supabase } from '../../lib/supabase';

// The Send feedback pop-up (Team Beta, 2026-11-10, Mockup 25 B and C),
// mounted once in _layout.tsx and opened with openFeedback() from the BETA
// pill in the top bar or Settings. Sends through the send-feedback edge
// function, which saves it and emails it to hello@therivalapp.com. The page
// it was opened from, the app version and the phone are attached for the
// member. On the iPhone app a screenshot of the page comes already attached
// (lib/feedback.ts); more can be added from photos, up to MAX_SHOTS.

// Dislike, not Other (Ricky, 2026-11-10): what testers don't like is the
// feedback that leads to fixes, so the pop-up asks for it directly.
// Quote (Ricky, 2026-11-11): testers can send a daily quote they like. Its
// own choice tells them quotes are welcome; Ricky picks which go into quotes.ts.
type Kind = 'problem' | 'idea' | 'dislike' | 'quote';
const KINDS: { value: Kind; label: string; icon: 'bug' | 'idea' | 'dislike' | 'formatQuote' }[] = [
  { value: 'problem', label: 'Problem', icon: 'bug' },
  { value: 'idea', label: 'Idea', icon: 'idea' },
  { value: 'dislike', label: 'Dislike', icon: 'dislike' },
  { value: 'quote', label: 'Quote', icon: 'formatQuote' },
];
const PLACEHOLDERS: Record<Kind, string> = {
  problem: 'What happened, and on which page?',
  idea: 'What would you like to see in RIVAL?',
  dislike: "What don't you like, and what would you change? Criticism is welcome.",
  quote: 'A quote for the daily quote, and who said it.',
};

const MAX_SHOTS = 5;

export function FeedbackHost() {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [kind, setKind] = useState<Kind>('problem');
  const [message, setMessage] = useState('');
  const [shots, setShots] = useState<FeedbackShot[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();
  // The page it was opened from, kept when the pop-up opens so a report says
  // where the member was, not where they are when they press Send.
  const [page, setPage] = useState('');

  useEffect(() => {
    setFeedbackListener((pageShot) => {
      setPage(pathname);
      setSent(false);
      setError(null);
      // A fresh capture of the page replaces the previous one; photos the
      // member added themselves stay.
      if (pageShot) setShots((prev) => [pageShot, ...prev.filter((p) => !p.uri.startsWith('data:'))].slice(0, MAX_SHOTS));
      setOpen(true);
    });
    return () => setFeedbackListener(null);
  }, [pathname]);

  function close() {
    setOpen(false);
    // A sent report starts fresh next time; an unsent one keeps its words.
    if (sent) {
      setSent(false);
      setKind('problem');
      setMessage('');
      setShots([]);
    }
  }

  async function pickShots() {
    const room = MAX_SHOTS - shots.length;
    if (room <= 0) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], quality: 0.6, base64: true, allowsMultipleSelection: true, selectionLimit: room,
    });
    if (result.canceled) return;
    const picked = (result.assets ?? []).filter((a) => a.base64)
      .map((a) => ({ uri: a.uri, base64: a.base64 as string, type: a.mimeType || 'image/jpeg' }));
    setShots((prev) => [...prev, ...picked].slice(0, MAX_SHOTS));
  }

  async function send() {
    if (!message.trim() || sending) return;
    setSending(true);
    setError(null);
    const version = Constants.expoConfig?.version ?? '';
    const device = Platform.OS === 'web'
      ? `Web, ${typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 100) : ''}`
      : [Device.modelName, Device.osName, Device.osVersion].filter(Boolean).join(' ');
    const { error: fnError } = await supabase.functions.invoke('send-feedback', {
      body: {
        kind, message: message.trim(), page,
        app_version: `${version} ${Platform.OS}`.trim(), device,
        screenshots: shots.map((p) => ({ base64: p.base64, type: p.type })),
      },
    });
    setSending(false);
    if (fnError) {
      let msg = 'Feedback could not be sent. Try again.';
      try {
        const body = await (fnError as { context?: Response }).context?.json();
        if (body?.error) msg = body.error;
      } catch { /* keep the general message */ }
      setError(msg);
      return;
    }
    setSent(true);
  }

  if (!open) return null;
  return (
    <Modal transparent visible animationType="slide" onRequestClose={close}>
      <View style={s.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={close} accessibilityLabel="Close" />
        {sent ? (
          <GreySheet title="Feedback sent" sub="Thank you for helping build RIVAL." onClose={close} footer={<GreyPrimary label="Done" onPress={close} />}>
            <View />
          </GreySheet>
        ) : (
          <GreySheet
            kicker="TEAM BETA"
            title="Send feedback"
            // Ricky, 2026-11-10: criticism is the feedback he wants most.
            sub="Honest criticism helps most."
            onClose={close}
            footer={<GreyPrimary label="Send" busy={sending} disabled={sending || !message.trim()} onPress={send} />}
          >
            <GreyLabel>Type</GreyLabel>
            <GreyArtTiles options={KINDS} value={kind} onChange={setKind} columns={2} />
            <GreyLabel>Details</GreyLabel>
            <GreyField
              value={message}
              onChangeText={setMessage}
              placeholder={PLACEHOLDERS[kind]}
              multiline
              maxLength={4000}
              style={s.details}
              textAlignVertical="top"
            />
            <GreyLabel>Screenshots</GreyLabel>
            {shots.length === 0 ? (
              <GreyArtTile label="Add screenshots" icon="addPhoto" onPress={pickShots} style={s.addBig} />
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.shots}>
                {shots.map((p, i) => (
                  <View key={p.uri + i} style={s.shot}>
                    <Image source={{ uri: p.uri }} style={s.shotImg} resizeMode="cover" />
                    <TouchableOpacity
                      onPress={() => setShots((prev) => prev.filter((_, j) => j !== i))}
                      style={s.remove} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove screenshot"
                    >
                      <RivalIcon name="close" size={14} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
                {shots.length < MAX_SHOTS ? (
                  <TouchableOpacity style={s.addMore} onPress={pickShots} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Add screenshots">
                    <RivalIcon name="addPhoto" size={22} color={RivalColors.accentText} />
                    <Text style={s.addMoreText}>Add</Text>
                  </TouchableOpacity>
                ) : null}
              </ScrollView>
            )}
            {error ? <Text style={s.error}>{error}</Text> : <GreyNote>App version and phone model are included.</GreyNote>}
          </GreySheet>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  details: { minHeight: 112, lineHeight: 22 },
  addBig: { width: '100%', height: 96 },
  shots: { gap: 8, paddingRight: 4 },
  shot: { width: 84, height: 150, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  shotImg: { width: '100%', height: '100%' },
  remove: {
    position: 'absolute', top: 5, right: 5, width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  addMore: {
    width: 84, height: 150, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,181,158,0.45)',
    backgroundColor: RivalGhost.fill, alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  addMoreText: { fontSize: 12.5, fontWeight: '800', color: RivalColors.accentText },
  error: { fontSize: 12.5, lineHeight: 17, color: RivalColors.error, marginTop: 8 },
});
