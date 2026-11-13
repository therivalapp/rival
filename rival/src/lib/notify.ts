import { Alert, Platform } from 'react-native';
import { emitAlert, emitConfirm, ConfirmOptions } from './alertBus';

// Alert.alert is a silent no-op on react-native-web, so failure messages on
// critical paths (leave team, sync failed, import failed) never reach web users.
// On web this now routes to RivalAlertHost (mounted once in _layout.tsx) — an
// on-brand styled modal — instead of the browser's native window.alert.
// The iPhone app keeps Apple's own alert: the styled host is a pop-up drawn
// from the root, and iPhone can't show it above a screen opened on top of the
// app (Start, for one), which left Discard doing nothing (tried 2026-11-13).
export function notify(title: string, message?: string) {
  if (Platform.OS === 'web') {
    emitAlert(title, message);
  } else {
    Alert.alert(title, message);
  }
}

// The yes/no counterpart. Replaces window.confirm, whose flat white
// "localhost says" dialog broke the app's look every time a user deleted
// something. Async — call sites `await` it instead of branching on a
// synchronous return.
export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  if (Platform.OS === 'web') return emitConfirm(opts);
  return new Promise<boolean>((resolve) => {
    Alert.alert(opts.title, opts.message, [
      { text: opts.cancelLabel ?? 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      {
        text: opts.confirmLabel ?? 'Confirm',
        style: opts.destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}
