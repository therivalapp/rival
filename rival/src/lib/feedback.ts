import { Platform } from 'react-native';

// Opens the Send feedback pop-up from anywhere (Team Beta, 2026-11-10,
// Mockups 25 and 26): the BETA pill in the top bar and the Send feedback row
// in Settings call openFeedback(); FeedbackHost, mounted once in _layout.tsx,
// listens and shows the pop-up over the current page.
//
// On the iPhone app the page is captured first, before the pop-up covers it,
// and arrives already attached (Ricky: "adding an image is the easiest way
// for people to explain the situation"). Not on the web: capturing a web
// page draws it again in the browser, which takes seconds on a full page.

export type FeedbackShot = { uri: string; base64: string; type: string };

type Listener = (pageShot: FeedbackShot | null) => void;
let listener: Listener | null = null;
let opening = false;

export function setFeedbackListener(l: Listener | null) {
  listener = l;
}

export async function openFeedback() {
  if (opening) return;
  opening = true;
  let shot: FeedbackShot | null = null;
  if (Platform.OS !== 'web') {
    try {
      const { captureScreen } = await import('react-native-view-shot');
      const base64 = await Promise.race([
        captureScreen({ format: 'jpg', quality: 0.6, result: 'base64' }),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
      shot = { uri: `data:image/jpeg;base64,${base64}`, base64, type: 'image/jpeg' };
    } catch {
      // No capture (an older build without the module, or it timed out):
      // the pop-up opens without one, and photos can still be added.
    }
  }
  opening = false;
  listener?.(shot);
}
