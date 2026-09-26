// Imported from the per-family subpaths, NOT the '@expo/vector-icons' barrel.
// The barrel registers every family's .ttf as a static asset at module scope,
// so importing two families from it shipped all of them -- FontAwesome (4/5/6),
// Ionicons, Fontisto, AntDesign, MaterialSymbols and more, none of which this
// app uses. That was ~3MB of fonts downloaded on first load for nothing.
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Svg, { Path } from 'react-native-svg';
import { StyleProp, TextStyle } from 'react-native';
import { RivalColors } from '../../constants/rivalTheme';

// Single source of truth for icons — semantic name → Material glyph. Material
// Symbols is what the Stitch mockups use, so MaterialIcons is a near-exact
// match, monochrome, and takes the accent color. Add new icons HERE, once,
// rather than reaching for an emoji in a screen (see feedback: real icons > emoji).
// Most entries are a plain MaterialIcons glyph name; a `['mci', name]` tuple
// pulls from MaterialCommunityIcons instead, for the rare case where that
// set has a better-proportioned glyph (e.g. notificationsActive, where
// MaterialIcons' bell has its ring-lines crowded right against the bell body).
const ICONS = {
  // Navigation / interface
  // The thin iOS-style chevron (not a full-shaft arrow, which read as a
  // generic "go back" link rather than the app-chrome back button Ricky
  // pointed at). Specifically the -new variant: plain 'arrow-back-ios'
  // draws its chevron in the LEFT half of its advance width (ink centre
  // sits 4.6px off at size 18), so it can never look centred inside
  // RivalBackButton's circle without a hand-tuned offset that would then
  // be wrong at every other icon size. 'arrow-back-ios-new' is the same
  // shape drawn centred (measured: 0.09px off), so no nudge is needed.
  back: 'arrow-back-ios-new',
  forward: 'arrow-forward',
  // Calendar month/year nav — chevron family (not arrow-back/forward above,
  // which are line-arrows and don't visually match the double-chevron).
  monthBack: 'keyboard-arrow-left',
  monthForward: 'keyboard-arrow-right',
  yearBack: 'keyboard-double-arrow-left',
  yearForward: 'keyboard-double-arrow-right',
  chevronRight: 'chevron-right',
  chevronLeft: 'chevron-left',
  send: 'send',
  respect: 'favorite',
  reply: 'reply',
  chevronDown: 'keyboard-arrow-down',
  edit: 'edit',
  more: 'more-vert',
  // Horizontal three dots — the overflow menu on the diary viewer, matching
  // Instagram's post menu.
  moreHoriz: 'more-horiz',
  close: 'close',
  eye: 'visibility',
  eyeOff: 'visibility-off',
  add: 'add',
  check: 'check',
  refresh: 'refresh',
  checkCircle: 'check-circle',
  checkCircleOutline: 'check-circle-outline',
  // Bare heartbeat waveform, no monitor-screen frame around it — MaterialIcons'
  // only pulse-shaped glyph (monitor-heart) bakes in that rounded-rect frame.
  pulse: ['mci', 'pulse'] as const,
  target: 'adjust',
  search: 'search',
  camera: 'photo-camera',
  upload: 'file-upload',
  notifications: 'notifications',
  notificationsActive: ['mci', 'bell-ring-outline'] as const,
  // Plain outline bell (mockup's ti-bell) — distinct from `notifications`
  // above, which is the filled glyph other screens already depend on.
  notificationsOutline: 'notifications-none',
  settings: 'settings',
  tune: 'tune',
  download: 'file-download',
  mail: 'mail-outline',
  notificationsOff: 'notifications-off',
  logout: 'logout',
  delete: 'delete-outline',
  link: 'link',
  openInNew: 'open-in-new',
  apps: 'apps',
  person: 'person',
  groups: 'groups',
  home: 'home',
  flag: 'flag',
  key: 'vpn-key',
  globe: 'public',
  // Ricky's pick from a side-by-side icon comparison, 2026-08-24
  // — MaterialCommunityIcons' open-outline speech bubble, not MaterialIcons'
  // filled one this used to be.
  chat: ['mci', 'chat-outline'] as const,
  pin: 'push-pin',
  star: 'star',
  starOutline: 'star-border',

  // Add Workout / logging
  scan: 'document-scanner',
  manual: 'edit-note',
  batch: 'calendar-view-week',
  addPhoto: 'add-a-photo',
  video: 'videocam',
  brain: 'psychology',
  verified: 'verified',
  ai: 'auto-awesome',
  calendar: 'calendar-today',
  calendarMonth: 'calendar-view-month',

  // Stats / metrics
  trophy: 'emoji-events',
  fire: 'local-fire-department',
  medal: 'military-tech',
  // Literal crown shape (no other call site depends on this glyph today —
  // verified via a repo-wide grep before changing it).
  crown: ['mci', 'crown-outline'] as const,
  lock: 'lock',               // locked milestone/achievement
  bolt: 'bolt',
  rest: 'bedtime',            // idle / no recent activity
  trendUp: 'trending-up',
  trendDown: 'trending-down',
  location: 'place',
  elevation: 'terrain',
  // Route/path glyph (no other call site depends on this today — verified
  // via a repo-wide grep) — was 'straighten' (a ruler), which reads as
  // measuring-tool rather than distance-traveled.
  distance: 'route',
  timer: 'timer',
  // MaterialIcons' plain "timer" renders with a solid-filled button/hand —
  // this outline variant for spots that need a lighter, unfilled stopwatch.
  timerOutline: ['mci', 'timer-outline'] as const,
  schedule: 'schedule',
  stats: 'bar-chart',
  race: 'sports-score',
  impact: 'auto-awesome',
  doubleChevronUp: 'keyboard-double-arrow-up',

  // Activity types
  run: 'directions-run',
  ride: 'directions-bike',
  swim: 'pool',
  rowing: 'rowing',
  weights: 'fitness-center',
  // MaterialIcons' 'sports-gymnastics' reads as a gymnast/ballet pose, not
  // a workout — this is the classic Olympic-lifting pictogram (barbell
  // overhead), a closer match for CrossFit's actual training style.
  crossfit: ['mci', 'weight-lifter'] as const,
  hyrox: 'local-fire-department',
  hiit: 'bolt',
  bootcamp: 'sports',
  hike: 'hiking',
  walk: 'directions-walk',
  yoga: 'self-improvement',
  ski: 'downhill-skiing',
  workout: 'fitness-center',
} as const;

export type RivalIconName = keyof typeof ICONS;

// The `['mci', name]` icons, as SVG outlines traced from the
// MaterialCommunityIcons font on the same 24-unit em box the font uses, so
// they draw identically. Rendering them from the font meant downloading the
// whole 1.3MB MaterialCommunityIcons.ttf for these six glyphs — and one of
// them is the bottom bar's Chat icon, so every page paid for it. Adding
// another ['mci', ...] icon means tracing it here too (fontTools, same
// transform: scale 24/512, flip y, offset by the 448 ascent).
const MCI_PATHS: Record<string, string> = {
  'pulse': 'M3 12.98H5.81L10.08 4.78L11.3 13.73L14.48 9.66L17.81 12.98H21V15H17.02L14.67 12.66L9.94 18.75L8.95 11.3L6.98 15H3Z',
  'bell-ring-outline': 'M9.98 21H14.02Q14.02 21.84 13.43 22.43Q12.84 23.02 12 23.02Q11.16 23.02 10.57 22.43Q9.98 21.84 9.98 21ZM21 18.98V20.02H3V18.98L5.02 17.02V11.02Q5.02 8.67 6.4 6.82Q7.78 4.97 9.98 4.31V3.98Q9.98 3.19 10.57 2.6Q11.16 2.02 12 2.02Q12.84 2.02 13.43 2.6Q14.02 3.19 14.02 3.98V4.31Q16.22 4.97 17.6 6.82Q18.98 8.67 18.98 11.02V17.02ZM17.02 11.02Q17.02 9.66 16.34 8.51Q15.66 7.36 14.51 6.68Q13.36 6 12 6Q10.64 6 9.49 6.68Q8.34 7.36 7.66 8.51Q6.98 9.66 6.98 11.02V18H17.02ZM19.73 3.19 18.33 4.59Q19.59 5.86 20.3 7.52Q21 9.19 21 11.02H23.02Q23.02 8.81 22.17 6.77Q21.33 4.73 19.73 3.19ZM0.98 11.02H3Q3 9.19 3.7 7.52Q4.41 5.86 5.67 4.59L4.27 3.19Q2.67 4.73 1.83 6.77Q0.98 8.81 0.98 11.02Z',
  'chat-outline': 'M12 3Q9.28 3 6.98 4.08Q4.69 5.16 3.35 6.98Q2.02 8.81 2.02 11.02Q2.02 12.61 2.74 14.06Q3.47 15.52 4.73 16.5Q4.73 17.16 4.27 18.09Q3.52 19.45 2.02 21Q3.75 20.91 5.41 20.27Q7.08 19.64 8.48 18.52Q10.22 18.98 12 18.98Q14.72 18.98 17.02 17.91Q19.31 16.83 20.65 15Q21.98 13.17 21.98 10.99Q21.98 8.81 20.65 6.98Q19.31 5.16 17.02 4.08Q14.72 3 12 3ZM12 17.02Q9.84 17.02 7.99 16.2Q6.14 15.38 5.06 13.99Q3.98 12.61 3.98 10.99Q3.98 9.38 5.06 7.99Q6.14 6.61 7.99 5.81Q9.84 5.02 12 5.02Q14.16 5.02 16.01 5.81Q17.86 6.61 18.94 7.99Q20.02 9.38 20.02 10.99Q20.02 12.61 18.94 13.99Q17.86 15.38 16.01 16.2Q14.16 17.02 12 17.02Z',
  'crown-outline': 'M12 8.02 15 13.22 18 10.5 17.3 14.02H6.7L6 10.5L9 13.22ZM12 3.98 8.48 9.98 3 5.02 5.02 15.98H18.98L21 5.02L15.52 9.98ZM18.98 18H5.02V18.98Q5.02 19.45 5.27 19.73Q5.53 20.02 6 20.02H18Q18.47 20.02 18.73 19.73Q18.98 19.45 18.98 18.98Z',
  'timer-outline': 'M12 20.02Q10.08 20.02 8.48 19.05Q6.89 18.09 5.95 16.5Q5.02 14.91 5.02 13.01Q5.02 11.11 5.95 9.49Q6.89 7.88 8.48 6.94Q10.08 6 12 6Q13.92 6 15.52 6.94Q17.11 7.88 18.05 9.49Q18.98 11.11 18.98 13.01Q18.98 14.91 18.05 16.5Q17.11 18.09 15.52 19.05Q13.92 20.02 12 20.02ZM19.03 7.41 20.44 5.95Q19.73 5.16 19.03 4.55L17.62 6Q16.45 5.06 15 4.52Q13.55 3.98 12 3.98Q9.56 3.98 7.5 5.2Q5.44 6.42 4.22 8.48Q3 10.55 3 12.98Q3 15.42 4.22 17.51Q5.44 19.59 7.5 20.79Q9.56 21.98 12 21.98Q14.44 21.98 16.52 20.79Q18.61 19.59 19.8 17.53Q21 15.47 21 12.98Q21 11.44 20.48 10.01Q19.97 8.58 19.03 7.41ZM11.02 14.02H12.98V8.02H11.02ZM15 0.98H9V3H15Z',
  'weight-lifter': 'M12 5.02Q11.16 5.02 10.57 5.6Q9.98 6.19 9.98 7.01Q9.98 7.83 10.57 8.41Q11.16 9 12 9Q12.84 9 13.43 8.41Q14.02 7.83 14.02 7.01Q14.02 6.19 13.43 5.6Q12.84 5.02 12 5.02ZM21.98 0.98V6H20.02V3.98H3.98V6H2.02V0.98H3.98V3H20.02V0.98ZM15 11.25V23.02H12.98V18H11.02V23.02H9V11.25Q7.41 10.41 6.45 8.88Q5.48 7.36 5.48 5.48V5.02H7.5V5.48Q7.5 7.36 8.81 8.67Q10.12 9.98 12 9.98Q13.88 9.98 15.19 8.67Q16.5 7.36 16.5 5.48V5.02H18.52V5.48Q18.52 7.36 17.55 8.88Q16.59 10.41 15 11.25Z',
};

export function RivalIcon({
  name,
  size = 24,
  color = RivalColors.textPrimary,
  style,
}: {
  name: RivalIconName;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  const glyph: string | readonly [string, string] = ICONS[name];
  if (Array.isArray(glyph)) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" style={style as any}>
        <Path d={MCI_PATHS[glyph[1]]} fill={color} />
      </Svg>
    );
  }
  return <MaterialIcons name={glyph as any} size={size} color={color} style={style} />;
}

// activity_type (DB value) → RivalIcon name. Mirrors ACTIVITY_ICONS keys.
const ACTIVITY_TYPE_TO_ICON: Record<string, RivalIconName> = {
  Run: 'run', VirtualRun: 'run',
  Ride: 'ride', VirtualRide: 'ride',
  Swim: 'swim',
  Rowing: 'rowing',
  WeightTraining: 'weights', Workout: 'workout',
  CrossFit: 'crossfit',
  Hyrox: 'hyrox',
  HIIT: 'hiit',
  Bootcamp: 'bootcamp',
  Hike: 'hike',
  Walk: 'walk',
  Yoga: 'yoga',
  AlpineSki: 'ski', NordicSki: 'ski',
};

export function activityIconName(type: string | null | undefined): RivalIconName {
  return ACTIVITY_TYPE_TO_ICON[type ?? ''] ?? 'workout';
}
