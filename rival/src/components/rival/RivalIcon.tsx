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
  remove: 'remove',
  watch: 'watch',
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

  // More activity types, so each has its own icon rather than the generic
  // dumbbell (2026-09-28). Glyphs from MaterialIcons unless a tuple.
  hyroxRun: ['mci', 'run-fast'] as const,
  eBike: 'electric-bike',
  mtb: 'pedal-bike',
  nordicSki: ['mci', 'ski-cross-country'] as const,
  nordicWalk: 'nordic-walking',
  snowboard: 'snowboarding',
  snowshoe: 'snowshoeing',
  iceSkate: 'ice-skating',
  inlineSkate: 'roller-skating',
  skateboard: 'skateboarding',
  paddle: 'kayaking',
  surf: 'surfing',
  kitesurf: 'kitesurfing',
  sail: 'sailing',
  climb: ['mci', 'carabiner'] as const,
  stairs: 'stairs',
  pilates: 'accessibility-new',
  martialArts: 'sports-martial-arts',
  fencing: ['mci', 'fencing'] as const,
  golf: 'sports-golf',
  tennis: 'sports-tennis',
  badminton: ['mci', 'badminton'] as const,
  tableTennis: ['mci', 'table-tennis'] as const,
  racquet: ['mci', 'racquetball'] as const,
  basketball: 'sports-basketball',
  volleyball: 'sports-volleyball',
  handball: 'sports-handball',
  hockey: 'sports-hockey',
  soccer: 'sports-soccer',
  americanFootball: 'sports-football',
  rugby: 'sports-rugby',
  cricket: 'sports-cricket',
  track: 'sports-score',
  wheelchair: 'accessible-forward',

  // Event types (the type tiles on Add event)
  eventHyrox: ['mci', 'run-fast'] as const,
  eventCustom: ['mci', 'flag-outline'] as const,
  eventTriathlon: ['mci', 'trophy-outline'] as const,
} as const;

export type RivalIconName = keyof typeof ICONS;

// The `['mci', name]` icons, as SVG outlines traced from the
// MaterialCommunityIcons font on the same 24-unit em box the font uses, so
// they draw identically. Rendering them from the font meant downloading the
// whole 1.3MB MaterialCommunityIcons.ttf for these few glyphs — and one of
// them is the bottom bar's Chat icon, so every page paid for it. Adding
// another ['mci', ...] icon means tracing it here too (fontTools, same
// transform: scale 24/512, flip y, offset by the 448 ascent).
const MCI_PATHS: Record<string, string> = {
  'badminton': 'M12.28 2.02Q11.58 2.02 11.09 2.55Q10.59 3.09 10.59 3.8Q10.64 4.17 10.78 4.5L11.06 5.16Q11.11 5.25 11.06 5.34Q11.02 5.44 10.9 5.48Q10.78 5.53 10.64 5.39L10.22 4.83Q9.7 4.12 8.86 4.12Q8.11 4.12 7.59 4.62Q7.08 5.11 7.05 5.79Q7.03 6.47 7.45 6.98L7.88 7.5Q8.02 7.73 7.85 7.85Q7.69 7.97 7.55 7.88L6.98 7.45Q6.47 7.03 5.79 7.05Q5.11 7.08 4.62 7.59Q4.12 8.11 4.12 8.86Q4.12 9.7 4.83 10.22L5.39 10.64Q5.48 10.73 5.48 10.83Q5.48 10.92 5.37 11.02Q5.25 11.11 5.11 11.06L4.5 10.78Q4.12 10.64 3.8 10.59Q3.09 10.59 2.55 11.09Q2.02 11.58 2.02 12.33Q2.02 12.84 2.3 13.31Q2.58 13.78 3.05 13.97L14.44 19.03L19.03 14.44L13.97 3.05Q13.78 2.58 13.31 2.27Q12.84 1.97 12.28 2.02ZM13.12 6.09Q13.45 6.09 13.71 6.26Q13.97 6.42 14.11 6.7L17.16 13.55L13.17 9.61L12.28 7.5Q12.05 7.03 12.33 6.56Q12.61 6.09 13.12 6.09ZM9.84 8.86Q10.27 8.86 10.55 9.14L15.38 13.97Q15.66 14.25 15.68 14.65Q15.7 15.05 15.4 15.35Q15.09 15.66 14.67 15.66Q14.25 15.66 13.97 15.38L9.14 10.55Q8.86 10.27 8.86 9.84Q8.86 9.42 9.14 9.14Q9.42 8.86 9.84 8.86ZM7.12 12.19Q7.31 12.19 7.5 12.28L9.61 13.22L13.55 17.16L6.7 14.11Q6.23 13.88 6.14 13.41Q6.05 12.94 6.33 12.54Q6.61 12.14 7.12 12.19ZM20.3 16.03 16.03 20.3 16.88 21.14Q17.44 21.7 18.21 21.91Q18.98 22.12 19.76 21.91Q20.53 21.7 21.12 21.12Q21.7 20.53 21.91 19.76Q22.12 18.98 21.91 18.21Q21.7 17.44 21.14 16.88Z',
  'fencing': 'M4.5 17.44 5.58 18.52 3.28 20.77Q3.05 21 2.74 21Q2.44 21 2.23 20.79Q2.02 20.58 2.02 20.25Q2.02 19.92 2.2 19.73ZM18.28 5.44V3.98L12 10.31L5.72 3.98V5.44L11.3 11.02L7.5 14.81Q6.61 14.16 5.51 14.25Q4.41 14.34 3.61 15.14L7.88 19.36Q8.67 18.61 8.74 17.51Q8.81 16.41 8.2 15.52ZM21.8 19.73 19.5 17.44 18.42 18.52 20.72 20.77Q20.95 21 21.26 21Q21.56 21 21.77 20.79Q21.98 20.58 21.98 20.25Q21.98 19.92 21.8 19.73ZM16.5 14.81 13.41 11.72 12.7 12.42 15.8 15.52Q15.19 16.41 15.26 17.51Q15.33 18.61 16.12 19.36L20.39 15.14Q19.59 14.34 18.49 14.25Q17.39 14.16 16.5 14.81Z',
  'table-tennis': 'M18.52 14.02Q19.55 14.02 20.27 14.74Q21 15.47 21 16.5Q21 17.53 20.27 18.26Q19.55 18.98 18.49 18.98Q17.44 18.98 16.71 18.26Q15.98 17.53 15.98 16.5Q15.98 15.47 16.71 14.74Q17.44 14.02 18.52 14.02ZM6.98 15Q7.12 15.14 7.27 15.28Q7.55 15.66 7.73 16.03Q8.02 16.55 8.02 17.02V20.48Q8.02 21.09 8.46 21.54Q8.91 21.98 9.49 21.98Q10.08 21.98 10.55 21.54Q11.02 21.09 11.02 20.48V17.02Q11.02 16.55 11.25 16.03Q11.44 15.66 11.72 15.28L12 15ZM8.02 14.02H11.02L11.77 13.92Q12.7 13.78 13.5 13.36Q14.58 12.84 15.23 11.91Q15.98 10.73 15.98 9Q15.98 6.66 14.86 4.97Q13.92 3.52 12.28 2.72Q10.88 2.02 9.49 2.02Q8.11 2.02 6.7 2.72Q5.11 3.52 4.12 4.97Q3 6.66 3 9Q3 11.2 4.31 12.52Q5.2 13.45 6.7 13.83Q7.45 14.02 8.02 14.02Z',
  'racquetball': 'M18.52 15.98Q19.55 15.98 20.27 16.71Q21 17.44 21 18.49Q21 19.55 20.27 20.27Q19.55 21 18.49 21Q17.44 21 16.71 20.27Q15.98 19.55 15.98 18.49Q15.98 17.44 16.71 16.71Q17.44 15.98 18.52 15.98ZM10.5 0.98Q7.73 0.98 6.19 1.5Q4.64 2.02 3.94 3.09Q3.28 4.08 3.14 5.86Q3 6.98 3 9.8Q3 11.39 3.98 13.22Q4.88 14.81 6.26 16.15Q7.64 17.48 9 18.09V23.02H12V18.09Q13.36 17.48 14.74 16.15Q16.12 14.81 17.02 13.22Q18 11.39 18 9.8Q18 6.94 17.91 5.81Q17.72 4.03 17.06 3.09Q16.36 1.97 14.81 1.48Q13.27 0.98 10.5 0.98ZM15.42 4.22Q15.61 4.45 15.7 4.97Q15.8 5.3 15.89 6H15V3.8Q15.14 3.89 15.33 4.08ZM15.98 9.8Q15.98 9.89 15.98 9.98H15V6.98H15.98ZM14.02 14.02H11.02V11.02H14.02ZM6.98 14.02V11.02H9.98V14.02ZM5.02 9.8Q5.02 9.66 5.02 9.52V6.98H6V9.98H5.02ZM6.98 6.98H9.98V9.98H6.98ZM11.02 3Q12.23 3 13.78 3.28H14.02V6H11.02ZM9.98 6H6.98V3.42Q8.2 3 9.98 3ZM11.02 9.98V6.98H14.02V9.98ZM6 3.8V6H5.11Q5.2 5.3 5.3 4.97Q5.39 4.45 5.58 4.22ZM5.2 11.02H6V12.7L5.77 12.23Q5.34 11.44 5.2 11.02ZM8.02 15H9.98V16.31L9.8 16.22Q9.19 15.98 8.02 15ZM11.2 16.31H11.02V15H12.98Q11.81 15.98 11.2 16.31ZM15 12.7V11.02H15.8Q15.61 11.48 15 12.7Z',
  'carabiner': 'M8.02 17.48Q8.02 18.14 7.57 18.56Q7.12 18.98 6.49 18.98Q5.86 18.98 5.44 18.56Q5.02 18.14 5.02 17.51Q5.02 16.88 5.44 16.43Q5.86 15.98 6.49 15.98Q7.12 15.98 7.57 16.43Q8.02 16.88 8.02 17.48ZM18 5.58Q17.86 4.03 16.78 3.02Q15.7 2.02 14.25 2.02H8.86Q7.45 2.02 6.38 3.02Q5.3 4.03 5.16 5.53L5.02 6.61Q4.92 7.17 5.3 7.59Q5.67 8.02 6.19 8.02Q6.7 8.02 7.05 7.69Q7.41 7.36 7.45 6.89L7.59 5.81Q7.64 5.25 8.02 4.88Q8.39 4.5 8.86 4.5H14.25Q14.72 4.5 15.09 4.88Q15.47 5.25 15.52 5.81L16.5 16.88Q16.55 17.53 16.17 18.02Q15.8 18.52 15.23 18.52L10.03 17.81Q9.89 19.27 8.81 20.2L14.95 21H15.23Q16.03 21 16.73 20.67Q17.44 20.34 17.98 19.76Q18.52 19.17 18.8 18.35Q19.08 17.53 18.98 16.64ZM11.67 7.92Q11.2 7.64 10.71 7.76Q10.22 7.88 9.94 8.34L6.38 14.02H6.52Q7.78 14.02 8.81 14.86L12.05 9.66Q12.33 9.23 12.21 8.72Q12.09 8.2 11.67 7.92Z',
  'ski-cross-country': 'M18.98 14.02H17.58V21.98H18.98ZM6.42 21.98H5.02L6.98 14.02H8.44ZM8.77 9.56V12.98H6.98V8.3L11.62 6.33Q12.23 6.05 12.94 6.26Q13.64 6.47 14.06 7.08L15 8.58Q15.7 9.84 16.64 10.36Q17.67 11.02 18.98 11.02V12.84Q17.44 12.84 16.12 12.19Q15.05 11.67 13.88 10.36L13.31 13.17L15.28 15V21.98H13.41V16.5L11.48 14.53L9.75 21.98H7.78L10.45 8.91ZM15.98 3.98Q15.98 4.83 15.4 5.41Q14.81 6 13.99 6Q13.17 6 12.59 5.41Q12 4.83 12 4.01Q12 3.19 12.59 2.6Q13.17 2.02 13.99 2.02Q14.81 2.02 15.4 2.6Q15.98 3.19 15.98 3.98Z',
  'trophy-outline': 'M18 2.02Q17.3 2.02 16.64 2.65Q15.98 3.28 15.98 3.98H8.02Q8.02 3.28 7.36 2.65Q6.7 2.02 6 2.02H2.02V11.02Q2.02 11.77 2.62 12.38Q3.23 12.98 3.98 12.98H6.19Q6.52 14.67 7.59 15.66Q8.81 16.78 11.02 17.02V19.08Q9.98 19.22 9.28 19.73Q8.72 20.11 8.39 20.72Q8.16 21.14 8.06 21.61L8.02 21.98H15.98L15.94 21.61Q15.84 21.14 15.61 20.72Q15.28 20.11 14.72 19.73Q14.02 19.22 12.98 19.08V17.02Q15.19 16.78 16.41 15.66Q17.48 14.67 17.81 12.98H20.02Q20.77 12.98 21.38 12.38Q21.98 11.77 21.98 11.02V2.02ZM6 11.02H3.98V3.98H6ZM15.98 11.48Q15.98 13.17 15.28 13.97Q14.34 15 12 15Q9.66 15 8.72 13.97Q8.02 13.17 8.02 11.48V6H15.98ZM20.02 11.02H18V3.98H20.02Z',
  'run-fast': 'M16.5 5.48Q17.34 5.48 17.93 4.9Q18.52 4.31 18.52 3.49Q18.52 2.67 17.93 2.09Q17.34 1.5 16.5 1.5Q15.66 1.5 15.07 2.09Q14.48 2.67 14.48 3.49Q14.48 4.31 15.07 4.9Q15.66 5.48 16.5 5.48ZM12.89 19.41 13.92 15 15.98 17.02V23.02H18V15.52L15.89 13.5L16.5 10.5Q17.53 11.67 18.98 12.33Q20.44 12.98 21.98 12.98V11.02Q20.67 11.02 19.52 10.38Q18.38 9.75 17.72 8.58L16.69 6.98Q16.41 6.56 15.96 6.28Q15.52 6 15 6Q14.86 6 14.6 6.05Q14.34 6.09 14.2 6.09L9 8.3V12.98H11.02V9.61L12.8 8.91L11.2 17.02L6.28 15.98L5.91 18ZM3.98 9Q3.56 9 3.28 8.72Q3 8.44 3 8.02Q3 7.59 3.28 7.29Q3.56 6.98 3.98 6.98H6.98V9ZM5.02 5.02Q4.59 5.02 4.29 4.71Q3.98 4.41 3.98 3.98Q3.98 3.56 4.29 3.28Q4.59 3 5.02 3H9.98V5.02ZM3 12.98Q2.58 12.98 2.3 12.7Q2.02 12.42 2.02 12Q2.02 11.58 2.3 11.3Q2.58 11.02 3 11.02H6.98V12.98Z',
  'flag-outline': 'M12.38 6 12.75 8.02H18V14.02H14.62L14.25 12H6.98V6ZM14.02 3.98H5.02V21H6.98V14.02H12.61L12.98 15.98H20.02V6H14.39Z',
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

// activity_type (DB value) → RivalIcon name. Every type in scoring_config has one.
const ACTIVITY_TYPE_TO_ICON: Record<string, RivalIconName> = {
  Run: 'run', VirtualRun: 'run', TrailRun: 'run', Elliptical: 'run',
  TrackAndField: 'track',
  Ride: 'ride', VirtualRide: 'ride', GravelRide: 'ride', Velomobile: 'ride',
  MountainBikeRide: 'mtb', EBikeRide: 'eBike', EMountainBikeRide: 'eBike',
  Handcycle: 'wheelchair', Wheelchair: 'wheelchair',
  Swim: 'swim',
  Rowing: 'rowing', VirtualRow: 'rowing',
  Kayaking: 'paddle', Canoeing: 'paddle', StandUpPaddling: 'surf',
  Surfing: 'surf', Kitesurf: 'kitesurf', Windsurf: 'surf', Sail: 'sail',
  WeightTraining: 'weights', Workout: 'workout',
  CrossFit: 'crossfit',
  Hyrox: 'hyroxRun',
  HIIT: 'hiit',
  Bootcamp: 'bootcamp',
  Hike: 'hike', Snowshoe: 'snowshoe',
  Walk: 'walk',
  Yoga: 'yoga', Pilates: 'pilates',
  StairStepper: 'stairs',
  RockClimbing: 'climb',
  AlpineSki: 'ski', BackcountrySki: 'ski', NordicSki: 'nordicSki', RollerSki: 'nordicWalk',
  Snowboard: 'snowboard', IceSkate: 'iceSkate', InlineSkate: 'inlineSkate', Skateboard: 'skateboard',
  MartialArts: 'martialArts', Fencing: 'fencing',
  Golf: 'golf',
  Tennis: 'tennis', Pickleball: 'tennis', Padel: 'tennis',
  Badminton: 'badminton', TableTennis: 'tableTennis', Squash: 'racquet', Racquetball: 'racquet',
  Basketball: 'basketball', Volleyball: 'volleyball', Handball: 'handball',
  IceHockey: 'hockey', FieldHockey: 'hockey', Lacrosse: 'hockey',
  Soccer: 'soccer', Football: 'americanFootball', Rugby: 'rugby', Cricket: 'cricket',
  Frisbee: 'bootcamp',
};

export function activityIconName(type: string | null | undefined): RivalIconName {
  return ACTIVITY_TYPE_TO_ICON[type ?? ''] ?? 'workout';
}
