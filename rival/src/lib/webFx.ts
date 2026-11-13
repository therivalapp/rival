import { Platform } from 'react-native';

// Gradients and shadows written as CSS for the web. The web gets the object
// exactly as written. The iPhone app (React Native 0.85) can draw CSS
// gradients (experimental_backgroundImage) and CSS box shadows, so it gets
// those two and nothing else (masks, filters, transitions, cursors and the
// like stay web-only). Anything native cannot parse is skipped, not drawn,
// so a gradient it does not understand never breaks a screen.
// (2026-11-11: the iPhone app should look like the web.)
// The phone values of the CSS variables these styles use (global.css,
// phone media query), so the iPhone draws what a phone browser draws.
const MAIN_GLOW = 'radial-gradient(ellipse 70% 55% at 50% 0%, rgba(217, 119, 87, 0.17), rgba(217, 119, 87, 0.035) 60%, rgba(217, 119, 87, 0))';
const PHONE_VARS: Record<string, string> = {
  '--rival-main-glow': MAIN_GLOW,
  '--rival-hero-image': MAIN_GLOW,
  '--rival-button-image': 'linear-gradient(135deg, #D97757 0%, #ffb59e 100%)',
  '--rival-head-glow': 'none',
  '--rival-plain-image': 'none',
  '--rival-bg-wash': 'none',
};
const resolveVars = (v: string) =>
  v.replace(/var\((--[a-z-]+)(?:,\s*([^()]*))?\)/g, (_m, name, fb) => PHONE_VARS[name] ?? (fb ?? '').trim());

export function webFx(style: Record<string, any>): any {
  if (Platform.OS === 'web') return style;
  const out: Record<string, any> = {};
  // Gradient text (background-clip: text) has no native equivalent: drawing
  // the gradient would paint a solid box behind the word, so native keeps
  // the flat text colour instead.
  const clipsToText = style.backgroundClip === 'text' || style.WebkitBackgroundClip === 'text';
  const bg = !clipsToText && typeof style.backgroundImage === 'string' ? resolveVars(style.backgroundImage) : null;
  if (bg && !bg.includes('var(') && !bg.includes('url(')) {
    out.experimental_backgroundImage = bg === 'none' ? [] : bg;
  }
  // Gradient text: carried along for GradientText, which draws it with a
  // mask on iPhone (a plain Text ignores the key).
  if (clipsToText && typeof style.backgroundImage === 'string' && !style.backgroundImage.includes('url(')) {
    out.__gradientText = resolveVars(style.backgroundImage);
  }
  const shadow = typeof style.boxShadow === 'string' ? resolveVars(style.boxShadow) : null;
  if (shadow && !shadow.includes('var(')) out.boxShadow = shadow;
  return out;
}
