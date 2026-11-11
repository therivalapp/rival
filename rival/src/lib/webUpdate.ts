import { Platform } from 'react-native';

// Web app: picks up a new version by itself (2026-11-11). A page left open on a
// phone kept running the old code after a release (Ricky saw the old Full name
// box after First and Last name had shipped). Every few minutes, and whenever
// the app comes back to the screen, the live page is fetched and its code
// files compared with the ones running. When they differ, the app reloads the
// next time it is reopened, so nobody loses what they are typing.

const CODE = /\/_expo\/static\/js\/web\/(?:__common|entry)-[0-9a-f]+\.js/g;
const CHECK_EVERY_MS = 5 * 60 * 1000;

function running(): string {
  return Array.from(document.querySelectorAll('script[src]'))
    .map((s) => (s as HTMLScriptElement).src.match(CODE)?.[0] ?? '')
    .filter(Boolean).sort().join('|');
}

async function live(): Promise<string | null> {
  try {
    const res = await fetch(`/?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const html = await res.text();
    return (html.match(CODE) ?? []).sort().join('|') || null;
  } catch {
    return null;
  }
}

export function startWebUpdates() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
  const mine = running();
  if (!mine) return undefined; // the dev server has no hashed files
  let stale = false;

  const check = async () => {
    if (stale) return;
    const now = await live();
    if (now && now !== mine) stale = true;
  };
  const onVisible = async () => {
    if (document.visibilityState !== 'visible') return;
    if (!stale) await check();
    if (stale) window.location.reload();
  };

  const timer = setInterval(check, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
