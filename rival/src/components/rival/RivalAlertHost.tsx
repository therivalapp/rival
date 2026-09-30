import { useEffect, useState } from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { BREAKPOINT_WIDE_LAYOUT } from '../../constants/breakpoints';
import { RivalButtonColors } from '../../constants/rivalTheme';
import { ConfirmOptions, setAlertListener, setConfirmListener } from '../../lib/alertBus';
import { RivalColors, RivalRadius, RivalSerifFamily } from '../../constants/rivalTheme';

// Mounted once at the app root (_layout.tsx). Replaces window.alert's flat
// white browser dialog — notify() hands off here via alertBus so every
// existing notify() call site (14 files) gets this look for free, no
// per-call-site changes needed.
export function RivalAlertHost() {
  const [alert, setAlert] = useState<{ title: string; message?: string } | null>(null);
  const phone = useWindowDimensions().width < BREAKPOINT_WIDE_LAYOUT;
  // The confirm carries its resolver with it, so dismissing by any route
  // (button, back gesture) always settles the promise the caller is awaiting
  // — a confirm that never resolves would hang the call site forever.
  const [confirm, setConfirm] = useState<{ opts: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null);

  useEffect(() => {
    setAlertListener((title, message) => setAlert({ title, message }));
    setConfirmListener((opts, resolve) => setConfirm({ opts, resolve }));
    return () => { setAlertListener(null); setConfirmListener(null); };
  }, []);

  function settle(ok: boolean) {
    confirm?.resolve(ok);
    setConfirm(null);
  }

  if (confirm && phone) {
    // Phone: the blend. Grey box, serif title, the action as the one pill,
    // the way out as a quiet outline beneath it.
    const { opts } = confirm;
    return (
      <Modal transparent visible animationType="fade" onRequestClose={() => settle(false)}>
        <View style={styles.backdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => settle(false)} accessibilityLabel="Cancel" />
          <View style={[styles.card, pm.card]}>
            <Text style={[styles.title, pm.center]}>{opts.title}</Text>
            {opts.message ? <Text style={[styles.message, pm.center]}>{opts.message}</Text> : null}
            <TouchableOpacity style={[pm.primary, opts.destructive && pm.destructive]} onPress={() => settle(true)}>
              <Text style={[pm.primaryText, opts.destructive && pm.destructiveText]}>{opts.confirmLabel ?? 'Confirm'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={pm.ghost} onPress={() => settle(false)}>
              <Text style={pm.ghostText}>{opts.cancelLabel ?? 'Cancel'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  if (confirm) {
    const { opts } = confirm;
    return (
      <Modal transparent visible animationType="fade" onRequestClose={() => settle(false)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.title}>{opts.title}</Text>
            {opts.message ? <Text style={styles.message}>{opts.message}</Text> : null}
            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => settle(false)}>
                <Text style={styles.cancelBtnText}>{opts.cancelLabel ?? 'Cancel'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.closeBtn, styles.actionBtn, opts.destructive && styles.destructiveBtn]}
                onPress={() => settle(true)}
              >
                <Text style={[styles.closeBtnText, opts.destructive && styles.destructiveBtnText]}>
                  {opts.confirmLabel ?? 'Confirm'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  if (!alert) return null;

  if (phone) {
    return (
      <Modal transparent visible animationType="fade" onRequestClose={() => setAlert(null)}>
        <View style={styles.backdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setAlert(null)} accessibilityLabel="Close" />
          <View style={[styles.card, pm.card]}>
            <Text style={[styles.title, pm.center]}>{alert.title}</Text>
            {alert.message ? <Text style={[styles.message, pm.center]}>{alert.message}</Text> : null}
            <TouchableOpacity style={pm.ghost} onPress={() => setAlert(null)}>
              <Text style={pm.ghostText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => setAlert(null)}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{alert.title}</Text>
          {alert.message ? <Text style={styles.message}>{alert.message}</Text> : null}
          <TouchableOpacity style={styles.closeBtn} onPress={() => setAlert(null)}>
            <Text style={styles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: RivalColors.surfaceHigh,
    borderRadius: RivalRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 24,
    gap: 10,
  },
  title: {
    fontFamily: RivalSerifFamily,
    fontStyle: 'italic',
    fontWeight: '700',
    fontSize: 19,
    color: RivalColors.textPrimary,
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    color: RivalColors.textSecondary,
  },
  closeBtn: {
    marginTop: 12,
    alignSelf: 'flex-end',
    borderWidth: 1.5,
    borderColor: RivalColors.accentFill,
    borderRadius: RivalRadius.full,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  closeBtnText: {
    color: RivalColors.accentText,
    fontSize: 14,
    fontWeight: '700',
  },
  actions: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
  },
  // Cancels its own alignSelf/marginTop — inside `actions` the row does the
  // positioning, and keeping them would push this button out of line with
  // its sibling.
  actionBtn: { marginTop: 0, alignSelf: 'auto' },
  // Deliberately quieter than the confirm: an unbordered text button, so the
  // outlined pill next to it is the one the eye lands on.
  cancelBtn: { paddingHorizontal: 12, paddingVertical: 10 },
  cancelBtnText: {
    color: RivalColors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  destructiveBtn: { borderColor: RivalColors.error },
  destructiveBtnText: { color: RivalColors.error },
});

// Phone: the blend.
const pm = StyleSheet.create({
  card: { borderColor: RivalColors.surfaceBright, padding: 20, gap: 10 },
  center: { textAlign: 'center' },
  primary: {
    marginTop: 8, paddingVertical: 13, borderRadius: 999, alignItems: 'center',
    backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient,
    ...(Platform.OS === 'web' ? { boxShadow: '0 6px 22px rgba(217,119,87,0.28)' } : {}),
  } as any,
  primaryText: { fontSize: 15, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill) },
  destructive: { backgroundColor: 'rgba(255,107,107,0.14)', borderWidth: 1, borderColor: 'rgba(255,143,143,0.45)', ...RivalButtonColors.noGradient, ...(Platform.OS === 'web' ? { boxShadow: 'none' } : {}) } as any,
  destructiveText: { color: '#ff8f8f' },
  ghost: { paddingVertical: 12, borderRadius: 999, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,181,158,0.35)' },
  ghostText: { fontSize: 14.5, fontWeight: '700', color: RivalColors.accentText },
});
