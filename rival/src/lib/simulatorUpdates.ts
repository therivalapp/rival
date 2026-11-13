import { AppState, Platform } from 'react-native';
import * as Updates from 'expo-updates';

// Simulator build only (update channel `simulator`, used on Appetize to check
// every iPhone screen): load a newer update the moment the app opens or comes
// back to the front, instead of on the next cold start. Appetize has no
// restart button, so without this a fix could only be seen after a new build
// or a new session. TestFlight and App Store builds (channel `production`)
// keep the normal behaviour: the update downloads quietly and shows on the
// next open.
export const isSimulatorChannel = Platform.OS !== 'web' && !__DEV__ && Updates.channel === 'simulator';

async function check() {
  try {
    const res = await Updates.checkForUpdateAsync();
    if (!res.isAvailable) return;
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync();
  } catch {
    // No network or no update server: carry on with what is installed.
  }
}

let listening = false;
export function applySimulatorUpdate() {
  if (!isSimulatorChannel) return;
  check();
  if (listening) return;
  listening = true;
  AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
}
