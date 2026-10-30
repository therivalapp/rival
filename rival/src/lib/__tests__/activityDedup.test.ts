import { describe, it, expect, beforeEach } from 'vitest'
import { resolveCanonicalActivityId, type ActivityCandidate } from '../../../supabase/functions/_shared/activityDedup'

// A minimal in-memory stand-in for the Supabase client: just the query shapes
// activityDedup.ts uses (eq / gte / lte / maybeSingle / update / upsert).
type Row = Record<string, any>
function fakeSupabase(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const rows = (tables[table] ??= [])
      const filters: ((r: Row) => boolean)[] = []
      let patch: Row | null = null
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => { filters.push((r) => String(r[k]) === String(v)); return q },
        gte: (k: string, v: string) => { filters.push((r) => r[k] >= v); return q },
        lte: (k: string, v: string) => { filters.push((r) => r[k] <= v); return q },
        update: (p: Row) => { patch = p; return q },
        upsert: (row: Row) => {
          const hit = rows.find((r) => r.user_id === row.user_id && r.provider === row.provider && r.provider_activity_id === row.provider_activity_id)
          if (hit) Object.assign(hit, row)
          else rows.push({ ...row })
          return Promise.resolve({ error: null })
        },
        maybeSingle: () => Promise.resolve({ data: rows.find((r) => filters.every((f) => f(r))) ?? null }),
        then: (res: (v: unknown) => void) => {
          const hits = rows.filter((r) => filters.every((f) => f(r)))
          if (patch) hits.forEach((r) => Object.assign(r, patch))
          res({ data: hits, error: null })
        },
      }
      return q
    },
  }
}

const user = 'u1'
const start = '2026-10-28T07:47:29Z'
// Today's real pair: the phone recorded the whole run, the watch started late.
const phone: ActivityCandidate = { userId: user, provider: 'strava', providerActivityId: '111', activityType: 'Run', startedAt: start, durationSeconds: 1640, distanceMeters: 4800 }
const watch: ActivityCandidate = { userId: user, provider: 'strava', providerActivityId: '222', activityType: 'Run', startedAt: '2026-10-28T07:49:00Z', durationSeconds: 1544, distanceMeters: 4517 }

let db: Record<string, Row[]>
let sb: ReturnType<typeof fakeSupabase>
beforeEach(() => {
  db = { activities: [], activity_sources: [], deleted_activity_sources: [] }
  sb = fakeSupabase(db)
})

// What a caller does with the result: overwrite the row, or insert a new one.
async function sync(c: ActivityCandidate) {
  const r = await resolveCanonicalActivityId(sb, c)
  if (r.discard) return r
  const fields = { activity_type: c.activityType, started_at: c.startedAt, duration_seconds: c.durationSeconds, distance_meters: c.distanceMeters }
  if (r.canonicalId) Object.assign(db.activities.find((a) => a.id === r.canonicalId)!, fields)
  else {
    const id = `a${db.activities.length + 1}`
    db.activities.push({ id, user_id: c.userId, provider: c.provider, provider_activity_id: c.providerActivityId, ...fields })
    db.activity_sources.push({ user_id: c.userId, activity_id: id, provider: c.provider, provider_activity_id: c.providerActivityId })
  }
  return r
}

describe('two recordings of one run', () => {
  it('keeps the longer phone recording when the shorter watch one arrives second', async () => {
    await sync(phone)
    const r = await sync(watch)
    expect(r.discard).toBe(true)
    expect(db.activities).toHaveLength(1)
    expect(db.activities[0]).toMatchObject({ provider_activity_id: '111', distance_meters: 4800 })
    // Both recordings stay linked, so a re-sync of either takes the fast path.
    expect(db.activity_sources).toHaveLength(2)
  })

  it('switches to the longer recording when it arrives second', async () => {
    await sync(watch)
    await sync(phone)
    expect(db.activities).toHaveLength(1)
    expect(db.activities[0]).toMatchObject({ provider_activity_id: '111', distance_meters: 4800 })
  })

  it('still refuses the shorter recording on a later re-sync', async () => {
    await sync(phone)
    await sync(watch)
    const r = await sync(watch)
    expect(r.discard).toBe(true)
    expect(db.activities[0].distance_meters).toBe(4800)
  })

  it('restores the longer recording when it re-syncs after the shorter one overwrote it', async () => {
    // Today's state: both linked, the row showing the watch's numbers.
    db.activities.push({ id: 'a1', user_id: user, provider: 'strava', provider_activity_id: '111', activity_type: 'Run', started_at: start, duration_seconds: 1544, distance_meters: 4517 })
    db.activity_sources.push({ user_id: user, activity_id: 'a1', provider: 'strava', provider_activity_id: '111' }, { user_id: user, activity_id: 'a1', provider: 'strava', provider_activity_id: '222' })
    // The row's id already names the phone recording, so its re-sync is an edit and lands.
    await sync(phone)
    expect(db.activities[0]).toMatchObject({ provider_activity_id: '111', distance_meters: 4800, duration_seconds: 1640 })
  })

  it('keeps a recording the athlete picked, even when the other is longer', async () => {
    await sync(watch)
    await sync(phone)
    // The athlete switches back to the watch (activity-recordings: pin + row id).
    db.activity_sources.forEach((s) => { s.raw_payload = { chosen: s.provider_activity_id === '222' } })
    Object.assign(db.activities[0], { provider_activity_id: '222', duration_seconds: 1544, distance_meters: 4517 })
    const r = await sync(phone)
    expect(r.discard).toBe(true)
    expect(db.activities[0]).toMatchObject({ provider_activity_id: '222', distance_meters: 4517 })
    // And a re-sync of the picked one keeps its pin.
    await resolveCanonicalActivityId(sb, { ...watch, rawPayload: { external_id: 'garmin_ping_1' } })
    expect(db.activity_sources.find((s) => s.provider_activity_id === '222')!.raw_payload).toMatchObject({ chosen: true, external_id: 'garmin_ping_1' })
  })

  it('lets the recording shown edit itself, even shorter (a trim in Strava)', async () => {
    await sync(phone)
    await sync({ ...phone, durationSeconds: 1500, distanceMeters: 4400 })
    expect(db.activities[0]).toMatchObject({ distance_meters: 4400 })
  })
})
