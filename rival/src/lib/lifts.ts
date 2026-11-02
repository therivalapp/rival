// Canonical lift names and the matcher that maps what someone typed (or what
// a scanned whiteboard said) onto one of them, so PBs group under one name.
// Lives here rather than in the scan screen so the screens that only need the
// matcher don't pull the whole scan screen into the shared bundle.

export const CANONICAL_LIFTS = [
  'Squat', 'Front Squat', 'Overhead Squat',
  'Bench Press', 'Incline Bench Press', 'Close Grip Bench Press',
  'Deadlift', 'Sumo Deadlift', 'Romanian Deadlift', 'Stiff Leg Deadlift',
  'Overhead Press', 'Push Press', 'Strict Press',
  'Clean', 'Power Clean', 'Hang Clean', 'Clean and Jerk',
  'Jerk', 'Push Jerk', 'Split Jerk',
  'Snatch', 'Power Snatch', 'Hang Snatch',
  // Accessory / compound lifts
  'Barbell Row', 'Pull-up', 'Dip', 'Bicep Curl', 'Hip Thrust', 'Lunge',
  'Leg Press', 'Lat Pulldown', 'Leg Curl', 'Leg Extension', 'Calf Raise',
  'Good Morning', 'Trap Bar Deadlift',
  // Variations & more accessories
  'Bulgarian Split Squat', 'Split Squat', 'Box Squat', 'Pause Squat', 'Shrug', 'Face Pull',
  'Pause Bench Press', 'Deficit Deadlift', 'Rack Pull', 'Incline Dumbbell Press',
  'Dumbbell Bench Press', 'Skullcrusher', 'Tricep Extension', 'Hammer Curl',
  'Cable Row', 'Dumbbell Row',
  // Bodyweight: bests by sets × reps (Ricky, 2026-10-16)
  'Push-up', 'Air Squat',
  // Calisthenics (Ricky, 2026-11-01): pulling, pushing, legs and core, by reps
  'Muscle-up', 'Inverted Row', 'Typewriter Pull-up', 'Archer Pull-up',
  'Diamond Push-up', 'Decline Push-up', 'Pike Push-up', 'Archer Push-up', 'Pseudo Planche Push-up',
  'Handstand Push-up', 'Ring Dip', 'Bench Dip',
  'Pistol Squat', 'Shrimp Squat', 'Jump Squat', 'Nordic Curl', 'Step-up', 'Glute Bridge', 'Box Jump',
  'Sit-up', 'Crunch', 'Leg Raise', 'Hanging Leg Raise', 'Toes to Bar', 'Knees to Elbows', 'V-up',
  'Hollow Rock', 'Russian Twist', 'Dragon Flag', 'Mountain Climber', 'Burpee',
  // Held for time: the reps field carries seconds. See HOLD_LIFTS.
  'Plank', 'Side Plank', 'Hollow Hold', 'L-sit', 'Dead Hang', 'Wall Sit', 'Handstand Hold',
  'Front Lever', 'Back Lever', 'Planche', 'Human Flag',
];

// Held for time, not repeated: `reps` holds the seconds, and the best is the
// longest single hold.
const HOLD_LIFTS = new Set(['Plank', 'Side Plank', 'Hollow Hold', 'L-sit', 'Dead Hang', 'Wall Sit', 'Handstand Hold', 'Front Lever', 'Back Lever', 'Planche', 'Human Flag']);

export function isHoldLift(name: string): boolean {
  return HOLD_LIFTS.has(matchCanonicalLift(name) ?? name);
}

// What the Calisthenics activity offers first, most common first.
export const CALISTHENICS_LIFTS = [
  'Pull-up', 'Push-up', 'Dip', 'Air Squat', 'Plank', 'Muscle-up', 'Inverted Row', 'Hanging Leg Raise',
  'Pike Push-up', 'Handstand Push-up', 'L-sit', 'Pistol Squat', 'Lunge', 'Burpee', 'Sit-up', 'Toes to Bar',
  'Handstand Hold', 'Ring Dip', 'Diamond Push-up', 'Dead Hang', 'Hollow Hold', 'Leg Raise', 'Glute Bridge', 'Mountain Climber',
  'Archer Push-up', 'Decline Push-up', 'Archer Pull-up', 'Typewriter Pull-up', 'Pseudo Planche Push-up', 'Bench Dip',
  'Shrimp Squat', 'Jump Squat', 'Nordic Curl', 'Step-up', 'Box Jump', 'Crunch', 'Knees to Elbows', 'V-up', 'Hollow Rock',
  'Russian Twist', 'Dragon Flag', 'Side Plank', 'Wall Sit', 'Front Lever', 'Back Lever', 'Planche', 'Human Flag',
];

// Maps a canonical lift to every known phrasing/abbreviation that should resolve to it.
// Each alias is normalized the same way as scanned input before comparison, so
// separators (&, +, commas, hyphens) and casing don't matter.
export const LIFT_ALIASES: Record<string, string[]> = {
  'Squat': ['squat', 'back squat', 'bs', 'barbell squat', 'bb squat', 'high bar squat', 'low bar squat', 'high bar back squat', 'low bar back squat'],
  'Front Squat': ['front squat', 'fs', 'barbell front squat', 'bb front squat'],
  'Overhead Squat': ['overhead squat', 'ohs', 'oh squat'],
  'Bench Press': ['bench press', 'bench', 'bb bench', 'flat bench', 'bp', 'barbell bench press', 'barbell bench', 'flat bench press', 'flat barbell bench press'],
  'Incline Bench Press': ['incline bench press', 'incline bench', 'incline bb bench', 'ibp', 'incline barbell bench press', 'incline barbell bench', 'incline press'],
  'Close Grip Bench Press': ['close grip bench press', 'close grip bench', 'cgbp', 'close grip barbell bench', 'cg bench press', 'cg bench'],
  'Deadlift': ['deadlift', 'dl', 'conventional deadlift', 'conventional dl', 'barbell deadlift', 'bb deadlift', 'conv deadlift'],
  'Sumo Deadlift': ['sumo deadlift', 'sumo dl', 'sdl', 'sumo'],
  'Romanian Deadlift': ['romanian deadlift', 'rdl', 'romanian dl'],
  'Stiff Leg Deadlift': ['stiff leg deadlift', 'sldl', 'stiff legged deadlift', 'straight leg deadlift', 'stiff leg dl'],
  'Overhead Press': ['overhead press', 'ohp', 'military press', 'strict overhead press', 'shoulder press', 'seated shoulder press', 'standing shoulder press', 'db shoulder press', 'dumbbell shoulder press', 'barbell shoulder press', 'barbell overhead press', 'bb overhead press', 'bb ohp', 'db overhead press', 'dumbbell overhead press', 'seated overhead press', 'standing overhead press'],
  'Push Press': ['push press', 'pp', 'barbell push press', 'bb push press', 'db push press', 'dumbbell push press'],
  'Strict Press': ['strict press', 'sp', 'strict shoulder press', 'strict barbell press'],
  'Clean': ['clean', 'squat clean', 'full clean', 'barbell clean', 'bb clean'],
  'Power Clean': ['power clean', 'pc'],
  'Hang Clean': ['hang clean', 'hc'],
  'Clean and Jerk': ['clean and jerk', 'clean jerk', 'c&j', 'cj', 'c j', 'cnj', 'clean n jerk'],
  'Jerk': ['jerk'],
  'Push Jerk': ['push jerk', 'pj'],
  'Split Jerk': ['split jerk', 'sj'],
  'Snatch': ['snatch', 'sn', 'squat snatch', 'full snatch', 'barbell snatch', 'bb snatch'],
  'Power Snatch': ['power snatch', 'ps'],
  'Hang Snatch': ['hang snatch', 'hsn'],
  'Barbell Row': ['barbell row', 'bb row', 'bent over row', 'bent over barbell row', 'pendlay row', 'bent row', 'bor'],
  'Pull-up': ['pull up', 'pullup', 'weighted pull up', 'weighted pullup', 'chin up', 'chinup', 'weighted chin up', 'strict pull up'],
  'Dip': ['dip', 'weighted dip', 'tricep dip', 'chest dip', 'parallel bar dip'],
  'Bicep Curl': ['bicep curl', 'biceps curl', 'barbell curl', 'bb curl', 'db curl', 'dumbbell curl', 'ez bar curl', 'ez curl', 'curl', 'dumbbell bicep curl', 'barbell bicep curl'],
  'Hip Thrust': ['hip thrust', 'barbell hip thrust', 'bb hip thrust'],
  'Push-up': ['push up', 'pushup', 'press up', 'pressup', 'strict push up', 'hand release push up'],
  'Air Squat': ['air squat', 'bodyweight squat', 'bw squat'],
  'Muscle-up': ['muscle up', 'muscleup', 'bar muscle up', 'ring muscle up', 'bmu', 'rmu'],
  'Inverted Row': ['inverted row', 'australian pull up', 'australian row', 'body row', 'bodyweight row', 'ring row', 'trx row'],
  'Typewriter Pull-up': ['typewriter pull up', 'typewriter pullup'],
  'Archer Pull-up': ['archer pull up', 'archer pullup'],
  'Diamond Push-up': ['diamond push up', 'diamond pushup', 'close grip push up'],
  'Decline Push-up': ['decline push up', 'decline pushup', 'feet elevated push up'],
  'Pike Push-up': ['pike push up', 'pike pushup'],
  'Archer Push-up': ['archer push up', 'archer pushup'],
  'Pseudo Planche Push-up': ['pseudo planche push up', 'pseudo planche pushup', 'planche push up', 'pppu'],
  'Handstand Push-up': ['handstand push up', 'handstand pushup', 'hspu', 'strict hspu', 'kipping hspu', 'wall handstand push up'],
  'Ring Dip': ['ring dip'],
  'Bench Dip': ['bench dip', 'chair dip'],
  'Pistol Squat': ['pistol squat', 'pistol', 'single leg squat', 'one leg squat'],
  'Shrimp Squat': ['shrimp squat'],
  'Jump Squat': ['jump squat', 'squat jump'],
  'Nordic Curl': ['nordic curl', 'nordic hamstring curl'],
  'Step-up': ['step up', 'stepup', 'box step up', 'db step up'],
  'Glute Bridge': ['glute bridge', 'hip bridge', 'single leg glute bridge'],
  'Box Jump': ['box jump', 'bj'],
  'Sit-up': ['sit up', 'situp', 'abmat sit up', 'ghd sit up'],
  'Crunch': ['crunch', 'ab crunch'],
  'Leg Raise': ['leg raise', 'lying leg raise'],
  'Hanging Leg Raise': ['hanging leg raise', 'hanging knee raise', 'hlr'],
  'Toes to Bar': ['toes to bar', 't2b', 'ttb', 'toe to bar'],
  'Knees to Elbows': ['knees to elbows', 'knee to elbow', 'k2e'],
  'V-up': ['v up', 'vup'],
  'Hollow Rock': ['hollow rock'],
  'Russian Twist': ['russian twist'],
  'Dragon Flag': ['dragon flag'],
  'Mountain Climber': ['mountain climber'],
  'Burpee': ['burpee', 'bar facing burpee'],
  'Plank': ['plank', 'front plank', 'forearm plank', 'high plank'],
  'Side Plank': ['side plank'],
  'Hollow Hold': ['hollow hold', 'hollow body hold'],
  'L-sit': ['l sit', 'lsit', 'l sit hold'],
  'Dead Hang': ['dead hang', 'bar hang', 'hang hold'],
  'Wall Sit': ['wall sit'],
  'Handstand Hold': ['handstand hold', 'handstand', 'wall handstand', 'free handstand', 'freestanding handstand'],
  'Front Lever': ['front lever'],
  'Back Lever': ['back lever'],
  'Planche': ['planche', 'tuck planche'],
  'Human Flag': ['human flag', 'flag hold'],
  'Lunge': ['lunge', 'walking lunge', 'db lunge', 'dumbbell lunge', 'barbell lunge', 'reverse lunge'],
  'Leg Press': ['leg press'],
  'Lat Pulldown': ['lat pulldown', 'lat pull down', 'pulldown', 'pull down', 'wide grip pulldown'],
  'Leg Curl': ['leg curl', 'hamstring curl', 'lying leg curl', 'seated leg curl'],
  'Leg Extension': ['leg extension', 'quad extension', 'knee extension'],
  'Calf Raise': ['calf raise', 'standing calf raise', 'seated calf raise'],
  'Good Morning': ['good morning', 'gm'],
  'Trap Bar Deadlift': ['trap bar deadlift', 'trap bar dl', 'hex bar deadlift', 'hex bar dl', 'trap bar', 'hex bar'],
  'Bulgarian Split Squat': ['bulgarian split squat', 'bulgarian', 'bss', 'rear foot elevated split squat', 'rfess'],
  'Split Squat': ['split squat', 'db split squat', 'dumbbell split squat', 'barbell split squat', 'bb split squat'],
  'Box Squat': ['box squat', 'bb box squat', 'barbell box squat'],
  'Pause Squat': ['pause squat', 'paused squat'],
  'Shrug': ['shrug', 'barbell shrug', 'bb shrug', 'db shrug', 'dumbbell shrug'],
  'Face Pull': ['face pull', 'cable face pull'],
  'Pause Bench Press': ['pause bench press', 'paused bench press', 'pause bench', 'paused bench'],
  'Deficit Deadlift': ['deficit deadlift', 'deficit dl'],
  'Rack Pull': ['rack pull', 'rack deadlift', 'rack dl'],
  'Incline Dumbbell Press': ['incline dumbbell press', 'incline db press', 'incline dumbbell bench press', 'incline db bench'],
  'Dumbbell Bench Press': ['dumbbell bench press', 'db bench press', 'db bench', 'dumbbell bench', 'flat db bench'],
  'Skullcrusher': ['skullcrusher', 'skull crusher', 'lying tricep extension', 'lying triceps extension', 'ez bar skullcrusher'],
  'Tricep Extension': ['tricep extension', 'triceps extension', 'overhead tricep extension', 'overhead triceps extension', 'cable tricep extension', 'overhead extension'],
  'Hammer Curl': ['hammer curl', 'db hammer curl', 'dumbbell hammer curl'],
  'Cable Row': ['cable row', 'seated cable row', 'seated row'],
  'Dumbbell Row': ['dumbbell row', 'db row', 'one arm row', 'single arm row', 'one arm dumbbell row', 'single arm dumbbell row'],
};

export function normalizeLiftName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[&+,/]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Strip a trailing plural "s" so "squats"/"deadlifts"/"cleans" match their singular
  // alias. Guarded: keep words ending in "ss" (press, cross) and short abbreviations
  // (bs, ps, ohs) untouched.
  if (base.length >= 4 && base.endsWith('s') && !base.endsWith('ss')) {
    return base.slice(0, -1);
  }
  return base;
}

const LIFT_ALIAS_LOOKUP: Record<string, string> = Object.entries(LIFT_ALIASES)
  .reduce((map, [canonical, aliases]) => {
    for (const alias of aliases) map[normalizeLiftName(alias)] = canonical;
    return map;
  }, {} as Record<string, string>);

export function matchCanonicalLift(name: string): string | null {
  return LIFT_ALIAS_LOOKUP[normalizeLiftName(name)] ?? null;
}
