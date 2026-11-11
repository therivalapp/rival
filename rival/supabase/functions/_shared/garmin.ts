// Garmin Connect (Activity API, Starter: push only, no history), 2026-11-11.
// OAuth2 with PKCE per Garmin's "OAuth2PKCE 2.0" spec. Keys are the Supabase
// secrets GARMIN_CLIENT_ID and GARMIN_CLIENT_SECRET.

export const GARMIN_AUTH_URL = 'https://connect.garmin.com/oauth2Confirm'
export const GARMIN_TOKEN_URL = 'https://diauth.garmin.com/di-oauth2-service/oauth/token'
export const GARMIN_USER_ID_URL = 'https://apis.garmin.com/wellness-api/rest/user/id'
export const GARMIN_REGISTRATION_URL = 'https://apis.garmin.com/wellness-api/rest/user/registration'

// Trimmed: a copy-paste into the Supabase secrets page can bring a space along.
export const garminClientId = () => (Deno.env.get('GARMIN_CLIENT_ID') ?? '').trim()
const garminClientSecret = () => (Deno.env.get('GARMIN_CLIENT_SECRET') ?? '').trim()

export const garminRedirectUri = () =>
  `${Deno.env.get('SUPABASE_URL')}/functions/v1/garmin-callback`

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function randomToken(bytes = 48): string {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return b64url(a)
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return b64url(new Uint8Array(digest))
}

export type GarminTokens = {
  access_token: string
  refresh_token: string
  expires_in?: number
  refresh_token_expires_in?: number
}

async function tokenRequest(params: Record<string, string>): Promise<GarminTokens> {
  const res = await fetch(GARMIN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: garminClientId(),
      client_secret: garminClientSecret(),
      ...params,
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Garmin token ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

export const exchangeCode = (code: string, verifier: string) =>
  tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: garminRedirectUri() })

export const refreshTokens = (refreshToken: string) =>
  tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken })

export function tokenRow(t: GarminTokens) {
  const now = Date.now()
  return {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    access_expires_at: new Date(now + (t.expires_in ?? 86400) * 1000).toISOString(),
    refresh_expires_at: t.refresh_token_expires_in ? new Date(now + t.refresh_token_expires_in * 1000).toISOString() : null,
  }
}

/** A connection's access token, refreshed and saved first if it has expired. */
// deno-lint-ignore no-explicit-any
export async function liveAccessToken(supabase: any, conn: any): Promise<string | null> {
  if (conn.access_token && conn.access_expires_at && new Date(conn.access_expires_at).getTime() > Date.now() + 60_000) {
    return conn.access_token
  }
  if (!conn.refresh_token) return null
  const t = await refreshTokens(conn.refresh_token)
  await supabase.from('garmin_connections').update(tokenRow(t)).eq('user_id', conn.user_id)
  return t.access_token
}

// Garmin activity types → RIVAL types (same table as the data-download import
// in src/lib/archive.ts; the API sends them in capitals). Anything else is Workout.
const GARMIN_TYPES: Record<string, string> = {
  running: 'Run', street_running: 'Run', track_running: 'Run', treadmill_running: 'VirtualRun', indoor_running: 'VirtualRun',
  trail_running: 'TrailRun', ultra_run: 'TrailRun', virtual_run: 'VirtualRun',
  cycling: 'Ride', road_biking: 'Ride', gravel_cycling: 'GravelRide', mountain_biking: 'MountainBikeRide',
  indoor_cycling: 'VirtualRide', virtual_ride: 'VirtualRide', e_bike_fitness: 'EBikeRide', e_bike_mountain: 'EMountainBikeRide',
  lap_swimming: 'Swim', open_water_swimming: 'Swim', swimming: 'Swim',
  walking: 'Walk', casual_walking: 'Walk', speed_walking: 'Walk', hiking: 'Hike',
  strength_training: 'WeightTraining', cardio: 'Workout', fitness_equipment: 'Workout', hiit: 'HIIT', yoga: 'Yoga', pilates: 'Pilates',
  indoor_rowing: 'Rowing', rowing: 'Rowing', elliptical: 'Elliptical', stair_climbing: 'StairStepper',
  resort_skiing_snowboarding_ws: 'AlpineSki', resort_skiing: 'AlpineSki', resort_snowboarding: 'Snowboard',
  backcountry_skiing_snowboarding_ws: 'BackcountrySki', cross_country_skiing_ws: 'NordicSki', snow_shoe_ws: 'Snowshoe',
  stand_up_paddleboarding: 'StandUpPaddling', kayaking: 'Kayaking', surfing: 'Surfing', golf: 'Golf',
  rock_climbing: 'RockClimbing', bouldering: 'RockClimbing', indoor_climbing: 'RockClimbing',
  tennis: 'Tennis', pickleball: 'Pickleball', soccer: 'Soccer', multi_sport: 'Workout', triathlon: 'Workout',
}
export const garminType = (raw: unknown) => GARMIN_TYPES[String(raw ?? '').toLowerCase()] ?? 'Workout'

/** Google encoded polyline from Garmin samples that carry a position. */
// deno-lint-ignore no-explicit-any
export function samplesToPolyline(samples: any[] | null | undefined): string | null {
  if (!Array.isArray(samples)) return null
  const pts = samples
    .filter((s) => Number.isFinite(s?.latitudeInDegree) && Number.isFinite(s?.longitudeInDegree))
    .map((s) => [s.latitudeInDegree as number, s.longitudeInDegree as number])
  if (pts.length < 2) return null
  // Thin long recordings (one sample a second) to at most about 1,500 points.
  const step = Math.max(1, Math.ceil(pts.length / 1500))
  const kept = pts.filter((_, i) => i % step === 0 || i === pts.length - 1)
  let out = '', pLat = 0, pLng = 0
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1
    let s = ''
    while (n >= 0x20) { s += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5 }
    return s + String.fromCharCode(n + 63)
  }
  for (const [lat, lng] of kept) {
    const la = Math.round(lat * 1e5), ln = Math.round(lng * 1e5)
    out += enc(la - pLat) + enc(ln - pLng)
    pLat = la; pLng = ln
  }
  return out
}
