import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Modal } from './RivalModal';
import { GreySheet, GreyLabel, GreyArtTiles, GreyField, GreyPrimary, GreyRows, GreyRow } from './RivalGreySheet';
import { RivalColors } from '../../constants/rivalTheme';
import { supabase } from '../../lib/supabase';
import {
  setSafetyListener, blockMember, markBlocked, firstName,
  type ReportTarget, type BlockTarget,
} from '../../lib/safety';

// The Report and Block pop-ups (Apple guideline 1.2, 2026-11-10, Mockup 27
// v8), mounted once in _layout.tsx and opened with openReport() and
// openBlock() from lib/safety.ts: the three-dot menu on someone else's post
// or profile, and the press menu on a chat message.
//
// Report is amber throughout and Block red throughout (Ricky, v3): reporting
// and blocking are serious, so they don't wear the everyday peach gradient.
// The reported or blocked member is never told.

type Reason = 'spam' | 'harassment' | 'inappropriate' | 'other';
const REASONS: { value: Reason; label: string; icon: 'spam' | 'harassment' | 'inappropriate' | 'moreHoriz' }[] = [
  { value: 'spam', label: 'Spam', icon: 'spam' },
  { value: 'harassment', label: 'Harassment', icon: 'harassment' },
  { value: 'inappropriate', label: 'Inappropriate', icon: 'inappropriate' },
  { value: 'other', label: 'Other', icon: 'moreHoriz' },
];
const KIND_LABEL = { activity: 'ACTIVITY', message: 'MESSAGE', member: 'MEMBER' } as const;

const AMBER = RivalColors.accentGold;
const RED = RivalColors.danger;

type State =
  | { type: 'report'; target: ReportTarget }
  | { type: 'reported'; target: ReportTarget; blocked: boolean }
  | { type: 'block'; target: BlockTarget }
  | null;

export function SafetyHost() {
  const [state, setState] = useState<State>(null);
  const [reason, setReason] = useState<Reason>('spam');
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSafetyListener((r) => {
      setReason('spam');
      setDetails('');
      setAlsoBlock(false);
      setError(null);
      setBusy(false);
      setState(r);
    });
    return () => setSafetyListener(null);
  }, []);

  const close = () => { if (!busy) setState(null); };

  async function sendReport(target: ReportTarget) {
    setBusy(true);
    setError(null);
    const { error: fnError } = await supabase.functions.invoke('send-report', {
      body: {
        target_kind: target.kind,
        target_id: target.targetId ?? null,
        reported_user_id: target.userId,
        reason,
        details: details.trim(),
        block: alsoBlock,
      },
    });
    setBusy(false);
    if (fnError) {
      let msg = 'The report could not be sent. Try again.';
      try {
        const body = await (fnError as { context?: Response }).context?.json();
        if (body?.error) msg = body.error;
        if (body?.reported) { setState({ type: 'reported', target, blocked: false }); return; }
      } catch { /* keep the general message */ }
      setError(msg);
      return;
    }
    if (alsoBlock) markBlocked(target.userId);
    setState({ type: 'reported', target, blocked: alsoBlock });
  }

  async function confirmBlock(target: BlockTarget) {
    setBusy(true);
    setError(null);
    const msg = await blockMember(target.userId);
    setBusy(false);
    if (msg) { setError(msg); return; }
    setState(null);
  }

  if (!state) return null;
  const first = firstName(state.target.name);

  let sheet;
  if (state.type === 'report') {
    const target = state.target;
    sheet = (
      <GreySheet
        kicker={`${target.name.toUpperCase()} · ${KIND_LABEL[target.kind]}`}
        kickerColor={AMBER}
        title="Report"
        sub={`${first} will not be notified.`}
        onClose={close}
        footer={<GreyPrimary label="Send" tone="warn" busy={busy} disabled={busy} onPress={() => sendReport(target)} />}
      >
        <GreyLabel>Reason</GreyLabel>
        <GreyArtTiles options={REASONS} value={reason} onChange={setReason} columns={2} tone="warn" />
        <GreyLabel>Details</GreyLabel>
        <GreyField
          value={details}
          onChangeText={setDetails}
          placeholder="Optional"
          multiline
          maxLength={2000}
          style={s.details}
          textAlignVertical="top"
        />
        <View style={s.gap} />
        <GreyRows>
          <BlockRow label={`Block ${first}`} value={alsoBlock} onChange={setAlsoBlock} />
        </GreyRows>
        {error ? <Text style={s.error}>{error}</Text> : null}
      </GreySheet>
    );
  } else if (state.type === 'reported') {
    sheet = (
      <GreySheet
        badge={{ icon: 'flag', color: AMBER, ring: 'rgba(245,183,89,0.14)' }}
        title="Report sent"
        sub={state.blocked ? `The RIVAL team will review it. ${first} is blocked.` : 'The RIVAL team will review it.'}
        onClose={close}
        footer={<GreyPrimary label="Done" tone="ghost" onPress={close} />}
      >
        <View />
      </GreySheet>
    );
  } else {
    const target = state.target;
    sheet = (
      <GreySheet
        badge={{ icon: 'block', color: RED, ring: 'rgba(255,92,92,0.14)' }}
        title={`Block ${target.name}?`}
        sub={`${first}'s posts and messages will be hidden. ${first} will not be notified.`}
        onClose={close}
        footer={
          <>
            <GreyPrimary label="Block" tone="danger" busy={busy} disabled={busy} onPress={() => confirmBlock(target)} />
            <GreyPrimary label="Cancel" tone="ghost" onPress={close} />
          </>
        }
      >
        {error ? <Text style={s.error}>{error}</Text> : <View />}
      </GreySheet>
    );
  }

  return (
    <Modal transparent visible animationType="slide" onRequestClose={close}>
      <View style={s.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={close} accessibilityLabel="Close" />
        {sheet}
      </View>
    </Modal>
  );
}

function BlockRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <GreyRow icon="block" label={label} iconColor={RED}>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: RivalColors.surfaceContainerHigh, true: RED }}
        thumbColor="#ffffff"
        {...(Platform.OS === 'web' ? ({ activeThumbColor: '#ffffff' } as any) : {})}
      />
    </GreyRow>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  details: { minHeight: 84, lineHeight: 22 },
  gap: { height: 10 },
  error: { fontSize: 12.5, lineHeight: 17, color: RivalColors.error, marginTop: 10 },
});
