// Total seconds across every activity a person has logged.
//
// PostgREST stops at 1,000 rows without saying so, so a plain select summed
// only the first 1,000 activities and anyone with a longer history (a full
// Strava import is often thousands) was under-counted for hour milestones.
// Paged here, ordered by id so no row is skipped or counted twice.
export async function lifetimeSeconds(supabase: any, userId: string): Promise<number> {
  const PAGE = 1000
  let total = 0
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('activities')
      .select('id, duration_seconds')
      .eq('user_id', userId)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error || !data) break
    for (const a of data) total += a.duration_seconds || 0
    if (data.length < PAGE) break
  }
  return total
}
