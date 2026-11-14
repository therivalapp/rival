// The youngest age that can create an account (Ricky, 2026-11-14): 13, or 16
// for people in Australia, where under-16s may not hold accounts on social
// media (from December 2025; whether RIVAL is covered is still a question for
// the legal review). Australia is read from the device: its time zone or its
// region setting. Both can be wrong for a traveller; this is a best guess,
// not proof of where someone is.

export function looksAustralian(timeZone?: string, locale?: string): boolean {
  if (timeZone && /^Australia\//.test(timeZone)) return true;
  // "en-AU", "en_AU", "zh-Hans-AU".
  if (locale && /[-_]AU\b/i.test(locale)) return true;
  return false;
}

function deviceTimeZoneAndLocale(): { timeZone?: string; locale?: string } {
  try {
    const o = Intl.DateTimeFormat().resolvedOptions();
    const nav = typeof navigator !== 'undefined' ? (navigator as any).language as string | undefined : undefined;
    return { timeZone: o.timeZone, locale: nav && /[-_]/.test(nav) ? nav : o.locale };
  } catch {
    return {};
  }
}

export function minimumAge(): number {
  const { timeZone, locale } = deviceTimeZoneAndLocale();
  return looksAustralian(timeZone, locale) ? 16 : 13;
}
