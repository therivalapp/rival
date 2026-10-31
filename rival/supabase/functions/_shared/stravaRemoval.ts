// Taking Strava data back out of RIVAL. Three things lead here: an activity
// deleted on Strava, one set to "Only you" (teammates must never see it), and
// someone revoking RIVAL's access on Strava's side. No URL imports, so the
// tests can load it.

// deno-lint-ignore no-explicit-any
type Db = any

// `private` is the older field for the same setting as visibility: only_me.
export function isPrivateOnStrava(activity: { visibility?: string | null; private?: boolean | null } | null | undefined): boolean {
  return activity?.visibility === 'only_me' || activity?.private === true
}

/** One Strava activity removed for this person; returns activities deleted.
 *  Resolved through activity_sources, not by matching
 *  activities.provider_activity_id directly: two overlapping recordings of one
 *  activity are merged into a single row, which keeps whichever id arrived
 *  first, so removing the other one would match nothing and the row would
 *  survive. A row with another source still standing is kept, as that activity
 *  still happened. */
export async function removeStravaActivity(supabase: Db, userId: string, stravaActivityId: string): Promise<number> {
  const { data: sourceRow } = await supabase
    .from('activity_sources')
    .select('activity_id')
    .eq('user_id', userId)
    .eq('provider', 'strava')
    .eq('provider_activity_id', stravaActivityId)
    .maybeSingle()

  await supabase
    .from('activity_sources')
    .delete()
    .eq('user_id', userId)
    .eq('provider', 'strava')
    .eq('provider_activity_id', stravaActivityId)

  // Falls back to the direct match for rows imported before provenance was
  // captured, which have no activity_sources entry at all.
  const activityId = sourceRow?.activity_id ?? null
  if (activityId) {
    const { count: remaining } = await supabase
      .from('activity_sources')
      .select('id', { count: 'exact', head: true })
      .eq('activity_id', activityId)
    if ((remaining ?? 0) > 0) {
      console.log('Strava removal for', stravaActivityId, '— activity kept,', remaining, 'other source(s) still reference it')
      return 0
    }
    const { count } = await supabase
      .from('activities')
      .delete({ count: 'exact' })
      .eq('id', activityId)
      .eq('user_id', userId)
    return count ?? 0
  }
  const { count } = await supabase
    .from('activities')
    .delete({ count: 'exact' })
    .eq('user_id', userId)
    .eq('provider', 'strava')
    .eq('provider_activity_id', stravaActivityId)
  return count ?? 0
}

// One page of a query, repeated until it runs out: a plain select stops at
// 1,000 rows, and a person's history can pass that.
async function allRows(page: (from: number, to: number) => Promise<{ data: { [k: string]: string }[] | null; error: unknown }>, key: string): Promise<string[]> {
  const out: string[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999)
    if (error) throw error
    out.push(...(data ?? []).map((r) => r[key]))
    if (!data || data.length < 1000) return out
  }
}

/** Everything that came from Strava for this person, then the connection
 *  itself (last, so a retry can still find them if this stops part way).
 *  Activities with another source, such as a personal archive, are kept. */
export async function removeAllStravaData(supabase: Db, userId: string): Promise<number> {
  const { error: sourcesError } = await supabase
    .from('activity_sources')
    .delete()
    .eq('user_id', userId)
    .eq('provider', 'strava')
  if (sourcesError) throw sourcesError

  const stillSourced = new Set(await allRows(
    (from, to) => supabase.from('activity_sources').select('activity_id').eq('user_id', userId).range(from, to),
    'activity_id',
  ))
  const fromStrava = await allRows(
    (from, to) => supabase.from('activities').select('id').eq('user_id', userId).eq('provider', 'strava').range(from, to),
    'id',
  )
  const toRemove = fromStrava.filter((id) => !stillSourced.has(id))

  let removed = 0
  for (let i = 0; i < toRemove.length; i += 200) {
    const { count, error } = await supabase
      .from('activities')
      .delete({ count: 'exact' })
      .in('id', toRemove.slice(i, i + 200))
      .eq('user_id', userId)
    if (error) throw error
    removed += count ?? 0
  }

  const { error: connectionError } = await supabase
    .from('fitness_connections')
    .delete()
    .eq('user_id', userId)
    .eq('provider', 'strava')
  if (connectionError) throw connectionError
  return removed
}
