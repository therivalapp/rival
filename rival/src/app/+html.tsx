import { ScrollViewStyleReset } from 'expo-router/html';

// Custom root HTML shell for the web export. Adds "Add to Home Screen" support —
// without these tags, iOS Safari always keeps its URL/back-forward bar visible;
// with them, launching from a home-screen icon opens fully chrome-less, like a
// native app.
// [css width, css height, pixel ratio] for each iPhone screen size.
const LAUNCH_SCREENS: [number, number, number][] = [
  [440, 956, 3], [402, 874, 3], [430, 932, 3], [393, 852, 3], [428, 926, 3],
  [390, 844, 3], [375, 812, 3], [414, 896, 3], [414, 896, 2], [375, 667, 2], [414, 736, 3],
];

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* maximum-scale=1 stops iOS Safari AUTO-ZOOMING when you focus an
            input whose font-size is under 16px — it zooms in, and never fully
            zooms back out, which shifts the whole layout. 28 inputs across the
            app are under 16px (many deliberately, down to 10px in Team Hub),
            so bumping them all would mean redesigning those screens.
            User-initiated pinch-zoom is unaffected: iOS has ignored
            maximum-scale for pinch since iOS 10 and only honours it for this
            automatic focus zoom. */}
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, shrink-to-fit=no, viewport-fit=cover" />

        {/* iOS home-screen install: standalone (chrome-less) launch */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="RIVAL" />
        {/* expo export copies app.json's icon to the root of dist, not to the
            path it has in the source tree — pointing at the source path gave
            iOS a 404 and a screenshot of the page as the home-screen icon. */}
        <link rel="apple-touch-icon" href="/icon.png" />

        {/* Android/Chrome install prompt + standalone display */}
        <meta name="theme-color" content="#0e0e0e" />
        <link rel="manifest" href="/manifest.json" />

        {/* iOS launch screens for the home-screen app, one per iPhone size:
            plain app-dark. They had the RIVAL wordmark on them, but a launch
            screen is a still picture, so RIVAL sat there until the page
            took over and began to pulse (Ricky, 2026-10-25: "stalls for a
            second and then starts to pulse"). Now the page's own wordmark
            (#rival-boot below) fades in already pulsing. Without them iOS
            shows a white screen while the page loads. iOS reads these when the app is added to the home
            screen, so an existing icon needs re-adding to pick them up. */}
        {LAUNCH_SCREENS.map(([w, h, r]) => (
          <link
            key={`${w}x${h}`}
            rel="apple-touch-startup-image"
            href={`/splash/launch-${w * r}x${h * r}.png`}
            media={`(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)`}
          />
        ))}

        {/* Manrope, loaded without holding up the first frame. As an
            ordinary stylesheet (an @import in global.css, as it was) the
            phone waited on Google before drawing anything, so the still
            launch picture stayed up longer and RIVAL sat there before it
            began to pulse (Ricky, 2026-10-24). The app waits for it before
            fading in (lib/appReveal.ts), so text never changes shape. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var l=document.createElement('link');l.rel='stylesheet';l.href='https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&display=swap';window.__rivalFonts=new Promise(function(r){l.onload=r;l.onerror=r;});document.head.appendChild(l);})();`,
          }}
        />

        {/* A phone held sideways keeps the phone design, as the native app
            stays portrait (app.json). Sideways a phone is wider than the
            840px wide-layout cut-off, so it used to switch to the desktop
            layout (Ricky, 2026-10-27: "it started showing the old website
            version"). Here the page is held to the phone's portrait width,
            centred, and the width the app reads (react-native-web takes it
            from visualViewport) is that width too, so every page lays out
            exactly as it does upright. Runs before the app's JavaScript. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var vv=window.visualViewport;if(!vv||!window.matchMedia||!matchMedia('(pointer: coarse)').matches)return;var d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(vv),'width');if(!d||!d.get)return;var el=document.documentElement;function col(){var s=Math.min(screen.width,screen.height);return s<500&&innerWidth>innerHeight?s:0;}function apply(){var c=col();el.classList.toggle('rival-phone-side',!!c);if(c)el.style.setProperty('--rival-phone-w',c+'px');}Object.defineProperty(vv,'width',{configurable:true,get:function(){var c=col();return c?c/(vv.scale||1):d.get.call(vv);}});apply();vv.addEventListener('resize',apply);})();`,
          }}
        />

        {/* Open the connection to Supabase while the app's JavaScript is still
            downloading, so the first data request doesn't also have to wait
            for DNS, TCP and TLS setup. Rendered at build time, when the
            EXPO_PUBLIC_ variables are available. */}
        {!!process.env.EXPO_PUBLIC_SUPABASE_URL && (
          <>
            <link rel="preconnect" href={process.env.EXPO_PUBLIC_SUPABASE_URL} crossOrigin="" />
            <link rel="dns-prefetch" href={process.env.EXPO_PUBLIC_SUPABASE_URL} />
          </>
        )}

        <ScrollViewStyleReset />

        {/* Every OTHER screen in this app is a react-native-web "app shell": locked to
            one viewport, RN's own ScrollViews handle scrolling internally. That's
            correct for them. An earlier attempt fixed iOS letterboxing by forcing the
            WHOLE document scrollable here — reverted, since the actual fix only
            applies to one screen (see index.tsx, which is a plain flowing document,
            not part of the app shell, for exactly this reason). Keep this to things
            safe for every route: a dark default backdrop so nothing white flashes
            through — never a height/overflow override. */}
        <style dangerouslySetInnerHTML={{ __html: `
          html, body, #root { background-color: #0e0e0e; }
          #root:empty { background-color: transparent; }
          /* The wordmark (#rival-boot below) shows, pulsing, while the app
             loads. A real element, not body::before as it was: changes to
             the pseudo-element didn't reliably take, on iOS or in Chrome, so
             it kept showing through the app as it faded in (Ricky,
             2026-10-24: "it flickers as it transitions to the Today page").
             The app removes it outright as it starts to fade in
             (lib/appReveal.ts), and fades in from dark a moment later. */
          #rival-boot {
            position: fixed; left: 0; right: 0; top: 50vh;
            transform: translateY(-50%); text-align: center;
            font: 600 22px/1 -apple-system, 'Helvetica Neue', Arial, sans-serif;
            letter-spacing: 0.32em; text-indent: 0.32em; color: #ffb59e;
            pointer-events: none;
            animation: rivalBootIn 450ms ease-out both, rivalBootPulse 1.65s ease-in-out 450ms infinite;
            /* Its own layer, so the pulse runs on the GPU and keeps going
               while the phone is busy starting the app's JavaScript (Ricky,
               2026-10-24: "RIVAL isn't pulsing"). */
            will-change: opacity, transform;
          }
          /* The app itself (the page, the bottom bar, the daily quote) is
             hidden until rival-shown, then fades in together, in one CSS
             transition (lib/appReveal.ts). A short delay, so the wordmark is
             gone before the app shows through. Only while opening: the daily
             quote fades itself out later, and a transition left on it would
             drag that. !important because the daily quote sets its own
             opacity inline, which otherwise wins and let it show over the
             wordmark before the app was ready. */
          html:not(.rival-ready) [data-rival-fade] { transition: opacity 600ms ease-out 120ms; }
          html:not(.rival-shown) [data-rival-fade] { opacity: 0 !important; }
          /* Fades in from the plain launch screen, then pulses with a slight
             shrink (Ricky, 2026-10-24: "make RIVAL pulse" when opening the
             app). */
          @keyframes rivalBootIn { from { opacity: 0; } to { opacity: 0.9; } }
          @keyframes rivalBootPulse {
            0%, 100% { opacity: 0.9; transform: translateY(-50%) scale(1); }
            /* Half the first version's dip and shrink (0.3, 0.95), at half
               its speed (1.1s): that was a little much (Ricky, 2026-10-24). */
            50% { opacity: 0.6; transform: translateY(-50%) scale(0.975); }
          }
          /* Expo's reset gives html/body/#root height:100%, which resolves
             against the LAYOUT viewport. On iOS standalone that is 59px
             shorter than the real screen (measured on device 2026-08-24:
             layout 793 vs screen/100vh 852), and body also carries
             overflow:hidden — so the bottom 59px of any in-flow content was
             clipped away, cutting the last card off mid-shape. The nav pill
             and the fixed backgrounds escaped it only because position:fixed
             ignores ancestor overflow, which is why they reached the true
             bottom while scroll content did not.

             100vh is the true screen height, so this un-clips that strip.
             It is a height correction, NOT the document-scroll override the
             comment above warns against: overflow is untouched, so the app
             shell still scrolls internally and index.tsx still flows. */
          html, body, #root { height: 100vh; }
          /* A phone held sideways: the page at the phone's portrait width,
             centred (see the script above). The transform holds the fixed
             parts (bottom bar, pop-ups) to that column too. */
          html.rival-phone-side body {
            width: var(--rival-phone-w); margin: 0 auto; transform: translateZ(0);
          }
        ` }} />
      </head>
      <body>
        <div id="rival-boot" aria-hidden="true">RIVAL</div>
        {children}
      </body>
    </html>
  );
}
