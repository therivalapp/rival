import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Tabs } from 'expo-router';

// The four bottom-nav screens as real tabs: each is built the first time it's
// opened and then kept, so switching back is instant and keeps its scroll
// position and data. They used to be pushed onto the stack on every tap,
// which rebuilt the screen each time and piled up hidden copies of it.
// The bar itself is drawn by each screen (RivalTopNav), so the tab bar here
// is hidden. Go to a tab with goToTab() from lib/tabNav, not router.push.
export default function TabsLayout() {
  // On the live site each screen's code is its own download, fetched on first
  // visit. Once the first screen has settled (after the podium has risen),
  // fetch the other tabs' code quietly so the first tap on each is instant.
  // This only downloads and loads the code; nothing is shown or fetched from
  // the database until the tab is opened.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const w = window as any;
    let idle: any;
    const timer = setTimeout(() => {
      // Wrapped so it never throws: in the dev build import() here doesn't
      // return a promise, and a failed download must not break the app.
      const load = (fn: () => unknown) => {
        try { Promise.resolve(fn()).catch(() => {}); } catch { /* ignore */ }
      };
      const warm = () => {
        load(() => import('./home'));
        load(() => import('./my-activities'));
        load(() => import('./team-feed'));
        load(() => import('./messages'));
      };
      idle = w.requestIdleCallback ? w.requestIdleCallback(warm, { timeout: 4000 }) : (warm(), 0);
    }, 4000);
    return () => {
      clearTimeout(timer);
      if (idle && w.cancelIdleCallback) w.cancelIdleCallback(idle);
    };
  }, []);

  return (
    <Tabs tabBar={() => null} backBehavior="history" screenOptions={{ headerShown: false, lazy: true }}>
      <Tabs.Screen name="home" />
      <Tabs.Screen name="my-activities" />
      <Tabs.Screen name="team-feed" />
      <Tabs.Screen name="messages" />
    </Tabs>
  );
}
