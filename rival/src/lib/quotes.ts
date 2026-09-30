export type QuoteCategory =
  | 'levelup'
  | 'unrivaled'
  | 'progress'
  | 'longterm'
  | 'consistency'
  | 'identity'
  | 'recovery'
  | 'nutrition'
  | 'community'
  | 'competition'
  | 'wisdom';

export type QuoteTone = 'blunt' | 'balanced' | 'encouraging';

export type Quote = { text: string; author?: string; category: QuoteCategory; tone: QuoteTone };

// Daily Perspectives (Momentum Lines) — written to the RIVAL brand voice doc:
// calm, confident, never shouting; consistency is the outcome, motivation is
// just one lever toward it. 150 lines across 11 categories x 3 tones.
export const QUOTES: Quote[] = [
  // ── LEVEL UP ──────────────────────────────────────────────────
  { text: "Your level is a receipt, not a gift.", category: 'levelup', tone: 'balanced' },
  { text: "Nobody levels up by accident.", category: 'levelup', tone: 'blunt' },
  { text: "The next rank isn't given. It's taken.", category: 'levelup', tone: 'blunt' },
  { text: "You don't rise. You climb.", category: 'levelup', tone: 'blunt' },
  { text: "No effort, no level.", category: 'levelup', tone: 'blunt' },
  { text: "The leaderboard doesn't care how you feel about it.", category: 'levelup', tone: 'blunt' },
  { text: "Earn it, or stay where you are.", category: 'levelup', tone: 'blunt' },
  { text: "You're closer to your next level than you think.", category: 'levelup', tone: 'encouraging' },
  { text: "Small efforts still move the needle.", category: 'levelup', tone: 'encouraging' },
  { text: "Whatever level you're at, you got there by showing up.", category: 'levelup', tone: 'encouraging' },
  { text: "The next version of you is already in motion.", category: 'levelup', tone: 'encouraging' },

  // ── UNRIVALED ─────────────────────────────────────────────────
  { text: "Unrivaled is a direction, not a finish line.", category: 'unrivaled', tone: 'balanced' },
  { text: "Nobody starts Unrivaled. Everybody can become it.", category: 'unrivaled', tone: 'balanced' },
  { text: "The standard moves. So do you.", category: 'unrivaled', tone: 'balanced' },
  { text: "Unrivaled is built one ordinary day at a time.", category: 'unrivaled', tone: 'balanced' },
  { text: "Your rival is whoever brings out your best.", category: 'unrivaled', tone: 'balanced' },
  { text: "The title isn't given. It's assembled, day by day.", category: 'unrivaled', tone: 'balanced' },
  { text: "Unrivaled just means you outlasted yesterday's version.", category: 'unrivaled', tone: 'balanced' },
  { text: "There's always a next standard to meet.", category: 'unrivaled', tone: 'balanced' },
  { text: "Few reach Unrivaled. Fewer stay there.", category: 'unrivaled', tone: 'blunt' },
  { text: "Unrivaled has no shortcuts.", category: 'unrivaled', tone: 'blunt' },
  { text: "You don't talk your way to Unrivaled.", category: 'unrivaled', tone: 'blunt' },
  { text: "The gap between good and Unrivaled is repetition.", category: 'unrivaled', tone: 'blunt' },
  { text: "Unrivaled doesn't wait for you to feel ready.", category: 'unrivaled', tone: 'blunt' },
  { text: "Comfortable and Unrivaled don't share a lane.", category: 'unrivaled', tone: 'blunt' },
  { text: "Everyone wants Unrivaled. Few will do what it takes.", category: 'unrivaled', tone: 'blunt' },
  { text: "You don't need to be Unrivaled today. Just closer than yesterday.", category: 'unrivaled', tone: 'encouraging' },
  { text: "Every Unrivaled athlete started exactly where you are.", category: 'unrivaled', tone: 'encouraging' },
  { text: "You're allowed to build this slowly.", category: 'unrivaled', tone: 'encouraging' },
  { text: "Becoming Unrivaled looks a lot like just continuing.", category: 'unrivaled', tone: 'encouraging' },
  { text: "Every activity moves you toward it.", category: 'unrivaled', tone: 'encouraging' },

  // ── PROGRESS ──────────────────────────────────────────────────
  { text: "Progress rarely announces itself.", category: 'progress', tone: 'balanced' },
  { text: "The scale isn't the only measure of movement.", category: 'progress', tone: 'balanced' },
  { text: "Some weeks you build. Some weeks you maintain. Both count.", category: 'progress', tone: 'balanced' },
  { text: "Progress compounds quietly before it shows loudly.", category: 'progress', tone: 'balanced' },
  { text: "The version of you from a year ago would notice the difference.", category: 'progress', tone: 'balanced' },
  { text: "Progress is just today, repeated on purpose.", category: 'progress', tone: 'balanced' },
  { text: "You're further along than the mirror shows.", category: 'progress', tone: 'encouraging' },
  { text: "A slow week is still a week moved forward.", category: 'progress', tone: 'encouraging' },
  { text: "The days that felt like nothing were doing something.", category: 'progress', tone: 'encouraging' },
  { text: "Be proud of quiet progress.", category: 'progress', tone: 'encouraging' },
  { text: "Progress is not linear.", category: 'progress', tone: 'blunt' },

  // ── LONG-TERM THINKING ────────────────────────────────────────
  { text: "Think in years, not weeks.", category: 'longterm', tone: 'balanced' },
  { text: "The long game rewards people who forget they're playing one.", category: 'longterm', tone: 'balanced' },
  { text: "Consistency now is currency later.", category: 'longterm', tone: 'balanced' },
  { text: "What you build slowly tends to last.", category: 'longterm', tone: 'balanced' },
  { text: "A decade of small choices outweighs one big one.", category: 'longterm', tone: 'balanced' },
  { text: "The compound effect doesn't care about your timeline.", category: 'longterm', tone: 'balanced' },
  { text: "Patience is a training variable too.", category: 'longterm', tone: 'balanced' },
  { text: "You have more time than you think.", category: 'longterm', tone: 'encouraging' },
  { text: "The reason you started is still true today.", category: 'longterm', tone: 'encouraging' },
  { text: "The slow build is still a build.", category: 'longterm', tone: 'encouraging' },
  { text: "Nothing about this needs to be rushed.", category: 'longterm', tone: 'encouraging' },
  { text: "You're allowed to take the long way.", category: 'longterm', tone: 'encouraging' },
  { text: "Your future self will thank you.", category: 'longterm', tone: 'encouraging' },
  { text: "This is a long relationship, not a short deadline.", category: 'longterm', tone: 'encouraging' },
  { text: "Quick fixes don't survive contact with real life.", category: 'longterm', tone: 'blunt' },

  // ── CONSISTENCY ───────────────────────────────────────────────
  { text: "Consistency is just showing up on the days it's inconvenient.", category: 'consistency', tone: 'balanced' },
  { text: "The habit matters more than the highlight.", category: 'consistency', tone: 'balanced' },
  { text: "Most results are just consistency, deferred.", category: 'consistency', tone: 'balanced' },
  { text: "The routine is the whole strategy.", category: 'consistency', tone: 'balanced' },
  { text: "Showing up today still counts, even if today is small.", category: 'consistency', tone: 'encouraging' },
  { text: "You don't need a perfect streak. You need a repeated one.", category: 'consistency', tone: 'encouraging' },
  { text: "Every time you show up, you make the next time easier.", category: 'consistency', tone: 'encouraging' },
  { text: "Consistency forgives a bad day. It just asks you to return.", category: 'consistency', tone: 'encouraging' },
  { text: "You've already proven you can keep showing up.", category: 'consistency', tone: 'encouraging' },
  { text: "Motivation isn't coming. Consistency doesn't need it to.", category: 'consistency', tone: 'blunt' },
  { text: "Skipping today makes tomorrow's excuse easier.", category: 'consistency', tone: 'blunt' },

  // ── IDENTITY ──────────────────────────────────────────────────
  { text: "Your habits are a more honest résumé than your intentions.", category: 'identity', tone: 'balanced' },
  { text: "You are what you repeat, not what you plan.", category: 'identity', tone: 'balanced' },
  { text: "Identity is built the same way rank is: one activity at a time.", category: 'identity', tone: 'balanced' },
  { text: "What you do consistently becomes who you are.", category: 'identity', tone: 'balanced' },
  { text: "Your actions are already telling your story. This just adds a chapter.", category: 'identity', tone: 'balanced' },
  { text: "The person you're training to become is watching how you train today.", category: 'identity', tone: 'balanced' },
  { text: "Become someone new, one day at a time.", category: 'identity', tone: 'encouraging' },
  { text: "The identity you want is closer than you think.", category: 'identity', tone: 'encouraging' },
  { text: "Every workout is evidence for who you're becoming.", category: 'identity', tone: 'encouraging' },
  { text: "You don't have to already be that person. You just have to keep choosing it.", category: 'identity', tone: 'encouraging' },
  { text: "You are what you repeatedly do, not what you occasionally intend.", category: 'identity', tone: 'blunt' },
  { text: "Talk doesn't build identity. Reps do.", category: 'identity', tone: 'blunt' },
  { text: "Stop deciding who you are. Start proving it.", category: 'identity', tone: 'blunt' },

  // ── RECOVERY ──────────────────────────────────────────────────
  { text: "Recovery is where the training actually takes effect.", category: 'recovery', tone: 'balanced' },
  { text: "Rest isn't the opposite of progress. It's part of it.", category: 'recovery', tone: 'balanced' },
  { text: "Your body adapts on the days you let it.", category: 'recovery', tone: 'balanced' },
  { text: "Fatigue and fitness can look identical from the outside.", category: 'recovery', tone: 'balanced' },
  { text: "The best programs plan rest as carefully as effort.", category: 'recovery', tone: 'balanced' },
  { text: "Taking the rest day is still training smart.", category: 'recovery', tone: 'encouraging' },
  { text: "You're allowed to recover without guilt.", category: 'recovery', tone: 'encouraging' },
  { text: "Skipping recovery doesn't make you tougher. It makes you slower.", category: 'recovery', tone: 'blunt' },
  { text: "Ignoring fatigue is how progress stalls.", category: 'recovery', tone: 'blunt' },

  // ── NUTRITION ─────────────────────────────────────────────────
  { text: "What you eat after training is still part of training.", category: 'nutrition', tone: 'balanced' },
  { text: "Fuel arrives before performance does.", category: 'nutrition', tone: 'balanced' },
  { text: "Hydration is a variable, not an afterthought.", category: 'nutrition', tone: 'balanced' },
  { text: "Recovery starts on your plate, not just in your bed.", category: 'nutrition', tone: 'balanced' },
  { text: "Your next meal is part of your next activity.", category: 'nutrition', tone: 'balanced' },
  { text: "Nutrition doesn't need to be complicated to matter.", category: 'nutrition', tone: 'balanced' },
  { text: "The body performs on what it's given, not what it's owed.", category: 'nutrition', tone: 'balanced' },
  { text: "Under-fueling isn't discipline. It's sabotage.", category: 'nutrition', tone: 'blunt' },
  { text: "You can't out-train a bad diet.", category: 'nutrition', tone: 'blunt' },
  { text: "Feeding yourself well is part of taking yourself seriously.", category: 'nutrition', tone: 'encouraging' },
  { text: "Hours in training deserve a few minutes in the kitchen.", category: 'nutrition', tone: 'balanced' },

  // ── COMMUNITY ─────────────────────────────────────────────────
  { text: "Training partners lend you motivation on the days you're short of it.", category: 'community', tone: 'balanced' },
  { text: "The people around you set your baseline without you noticing.", category: 'community', tone: 'balanced' },
  { text: "Shared effort feels lighter than solo effort.", category: 'community', tone: 'balanced' },
  { text: "Community turns discipline into routine.", category: 'community', tone: 'balanced' },
  { text: "You don't have to do this alone. Most people don't.", category: 'community', tone: 'encouraging' },
  { text: "The people training beside you make the hard days easier.", category: 'community', tone: 'encouraging' },
  { text: "Showing up together makes showing up easier.", category: 'community', tone: 'encouraging' },
  { text: "Your team is proof you're not the only one trying.", category: 'community', tone: 'encouraging' },
  { text: "Training alone forever is a choice, not a requirement.", category: 'community', tone: 'blunt' },
  { text: "We make each other better.", category: 'community', tone: 'encouraging' },
  { text: "The right people make you want to raise your own standard.", category: 'community', tone: 'balanced' },
  { text: "Surround yourself with people who expect your best.", category: 'community', tone: 'blunt' },

  // ── COMPETITION ───────────────────────────────────────────────
  { text: "Your rival isn't resting today.", category: 'competition', tone: 'blunt' },
  { text: "Someone is closing the gap while you hesitate.", category: 'competition', tone: 'blunt' },
  { text: "Respect your competition. Don't hide from it.", category: 'competition', tone: 'blunt' },
  { text: "The standings don't care about your reasons.", category: 'competition', tone: 'blunt' },
  { text: "Your only real competition is who you were yesterday.", category: 'competition', tone: 'encouraging' },
  { text: "You don't need to beat everyone. Just keep pace with your own growth.", category: 'competition', tone: 'encouraging' },
  { text: "A good rival makes you better, not smaller.", category: 'competition', tone: 'encouraging' },

  // ── WISDOM ────────────────────────────────────────────────────
  { text: "Growth doesn't follow a schedule. It follows effort.", category: 'wisdom', tone: 'balanced' },
  { text: "Every expert was, at some point, painfully average.", category: 'wisdom', tone: 'balanced' },
  { text: "The hardest part of growth is that you rarely notice it happening.", category: 'wisdom', tone: 'balanced' },
  { text: "Comparison measures the wrong thing.", category: 'wisdom', tone: 'balanced' },
  { text: "You're allowed to be a beginner at something new.", category: 'wisdom', tone: 'encouraging' },
  { text: "Everyone you admire started somewhere unimpressive.", category: 'wisdom', tone: 'encouraging' },
  { text: "The fact that this is hard doesn't mean you're doing it wrong.", category: 'wisdom', tone: 'encouraging' },
  { text: "You're already living a version of a goal you once had.", category: 'wisdom', tone: 'encouraging' },
  { text: "Whatever battle you're fighting, you don't have to win it today. Just continue it.", category: 'wisdom', tone: 'encouraging' },
];

// Weighted pool — Unrivaled and Level Up appear more often
const WEIGHTED_POOL: Quote[] = [
  ...QUOTES,
  ...QUOTES.filter((q) => q.category === 'unrivaled'),
  ...QUOTES.filter((q) => q.category === 'levelup'),
];

export function getQuote(tone?: QuoteTone): Quote {
  const pool = tone ? WEIGHTED_POOL.filter((q) => q.tone === tone) : WEIGHTED_POOL;
  const source = pool.length > 0 ? pool : WEIGHTED_POOL;
  return source[Math.floor(Math.random() * source.length)];
}

// Seeded by the calendar date (not the clock) — every reload on the same day
// lands on the same line instead of reshuffling on every page refresh, but
// it still rotates once the date changes. Users are in different timezones,
// so this is deliberately the device's local date, not a server day.
export function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
export function getDailyQuote(tone?: QuoteTone): Quote {
  const pool = tone ? WEIGHTED_POOL.filter((q) => q.tone === tone) : WEIGHTED_POOL;
  const source = pool.length > 0 ? pool : WEIGHTED_POOL;
  const todayKey = new Date().toDateString();
  return source[hashStr(todayKey) % source.length];
}

// Future use: context-aware serving
export function getQuoteByCategory(category: QuoteCategory): Quote {
  const pool = QUOTES.filter((q) => q.category === category);
  return pool[Math.floor(Math.random() * pool.length)];
}
