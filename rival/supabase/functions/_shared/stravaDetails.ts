// The finer details of a Strava activity (add_activity_details.sql): heart
// rate, pace, cadence, calories, shoes or bike, best efforts and splits, plus
// the activity's own time zone (add_utc_offset.sql).
//
// Most of this is only on Strava's DETAILED activity (GET /activities/{id}),
// not the list the syncs page through, so older activities are filled a few
// at a time on each sync: Strava caps how many reads an app makes per 15
// minutes and per day, and the whole team shares that allowance.

const API = 'https://www.strava.com/api/v3'

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// deno-lint-ignore no-explicit-any
export function detailFields(d: any): Record<string, unknown> {
  // deno-lint-ignore no-explicit-any
  const bestEfforts = Array.isArray(d.best_efforts) ? d.best_efforts.map((b: any) => ({
    name: String(b.name ?? ''),
    distance: num(b.distance),
    seconds: num(b.elapsed_time),
  })).filter((b: { distance: number | null; seconds: number | null }) => b.distance && b.seconds) : null
  // deno-lint-ignore no-explicit-any
  const splits = Array.isArray(d.splits_metric) ? d.splits_metric.map((s: any) => ({
    distance: num(s.distance),
    seconds: num(s.moving_time),
    elevation: num(s.elevation_difference),
  })).filter((s: { distance: number | null; seconds: number | null }) => s.distance && s.seconds) : null
  return {
    avg_heartrate: num(d.average_heartrate),
    max_heartrate: num(d.max_heartrate),
    avg_cadence: num(d.average_cadence),
    avg_watts: num(d.average_watts),
    calories: num(d.calories),
    avg_speed: num(d.average_speed),
    max_speed: num(d.max_speed),
    gear_name: typeof d.gear?.name === 'string' ? d.gear.name : null,
    best_efforts: bestEfforts && bestEfforts.length ? bestEfforts : null,
    splits: splits && splits.length ? splits : null,
    utc_offset_seconds: typeof d.utc_offset === 'number' ? Math.round(d.utc_offset) : null,
    details_fetched_at: new Date().toISOString(),
  }
}

/** Notes written on Strava, for an activity whose journal is still empty. */
// deno-lint-ignore no-explicit-any
export function stravaNotes(d: any): string | null {
  const t = typeof d.description === 'string' ? d.description.trim() : ''
  return t ? t : null
}

// Strava reports its read allowance as "15-minute,daily" usage and limits.
// Leave a margin so live syncs for the rest of the team still get through.
function nearLimit(res: Response): boolean {
  const usage = (res.headers.get('x-readratelimit-usage') ?? res.headers.get('x-ratelimit-usage') ?? '').split(',').map(Number)
  const limit = (res.headers.get('x-readratelimit-limit') ?? res.headers.get('x-ratelimit-limit') ?? '').split(',').map(Number)
  if (usage.length < 2 || limit.length < 2 || !limit[0] || !limit[1]) return false
  return usage[0] >= limit[0] * 0.7 || usage[1] >= limit[1] * 0.7
}

/** Fills the time zone on this person's Strava activities that lack one,
 *  from the activity list (200 per read). Writes only utc_offset_seconds. */
// deno-lint-ignore no-explicit-any
export async function fillMissingOffsets(supabase: any, userId: string, token: string, maxPages = 3): Promise<number> {
  const { data: missing } = await supabase
    .from('activities')
    .select('id, provider_activity_id')
    .eq('user_id', userId)
    .eq('provider', 'strava')
    .is('utc_offset_seconds', null)
    .not('provider_activity_id', 'is', null)
    .limit(2000)
  if (!missing?.length) return 0
  const want = new Map<string, string>(missing.map((r: { id: string; provider_activity_id: string }) => [String(r.provider_activity_id), r.id]))
  let filled = 0
  for (let page = 1; page <= maxPages && want.size; page++) {
    const res = await fetch(`${API}/athlete/activities?per_page=200&page=${page}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) break
    const list = await res.json()
    if (!Array.isArray(list) || !list.length) break
    // deno-lint-ignore no-explicit-any
    const updates = list.filter((a: any) => want.has(String(a.id)) && typeof a.utc_offset === 'number')
    for (let i = 0; i < updates.length; i += 20) {
      // deno-lint-ignore no-explicit-any
      await Promise.all(updates.slice(i, i + 20).map(async (a: any) => {
        const { error } = await supabase
          .from('activities')
          .update({ utc_offset_seconds: Math.round(a.utc_offset) })
          .eq('id', want.get(String(a.id)))
          .is('utc_offset_seconds', null)
        if (!error) filled++
        want.delete(String(a.id))
      }))
    }
    if (nearLimit(res) || list.length < 200) break
  }
  return filled
}

/** Reads the full details of a few of this person's older Strava activities
 *  that don't have them yet, newest first. Fills an empty journal from the
 *  Strava description; never replaces notes written in RIVAL. */
// deno-lint-ignore no-explicit-any
export async function fillMissingDetails(supabase: any, userId: string, token: string, max = 15): Promise<number> {
  const { data: rows } = await supabase
    .from('activities')
    .select('id, provider_activity_id, notes')
    .eq('user_id', userId)
    .eq('provider', 'strava')
    .is('details_fetched_at', null)
    .not('provider_activity_id', 'is', null)
    .order('started_at', { ascending: false })
    .limit(max)
  let filled = 0
  for (const row of rows ?? []) {
    const res = await fetch(`${API}/activities/${row.provider_activity_id}`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.status === 429) break
    if (res.status === 404) {
      // Gone from Strava (deleted or made private): don't keep asking.
      await supabase.from('activities').update({ details_fetched_at: new Date().toISOString() }).eq('id', row.id)
      continue
    }
    if (!res.ok) break
    const d = await res.json()
    const update = detailFields(d)
    const notes = stravaNotes(d)
    if (notes && !(row.notes ?? '').trim()) update.notes = notes
    const { error } = await supabase.from('activities').update(update).eq('id', row.id)
    if (!error) filled++
    if (nearLimit(res)) break
  }
  return filled
}
