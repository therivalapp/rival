// Routes (Strava's map polyline) are private to the person who recorded them
// and live in their own owner-only table, activity_routes — see
// supabase/private_routes.sql. Every importer writes them through here rather
// than onto the activities row, which teammates can read.
//
// deno-lint-ignore no-explicit-any
export async function saveActivityRoute(supabase: any, activityId: string, userId: string, polyline: string | null | undefined): Promise<void> {
  // No route on this sync (an indoor activity, or Strava left it out) — keep
  // any route already stored rather than wiping it.
  if (!polyline) return
  const { error } = await supabase
    .from('activity_routes')
    .upsert({ activity_id: activityId, user_id: userId, polyline }, { onConflict: 'activity_id' })
  if (error) console.log('Route save error:', JSON.stringify(error))
}
