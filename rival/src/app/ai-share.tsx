import { useState, useCallback, useEffect, useRef } from 'react';
import { RivalColors, RivalButtonColors, RivalSerifFamily, PHONE_CARD_BG, RivalGhost } from '../constants/rivalTheme';
import { sidePageWide, SIDE_PAGE_MAX_WIDTH } from '../constants/breakpoints';
import { RivalIcon, RivalBackButton, RivalMobileHeader, RivalWarm, rm, GreyPageHead } from '../components/rival';
import { StyleSheet, TouchableOpacity, View, Text, ScrollView, Platform, ActivityIndicator, Image, Animated, Easing, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { supabase, getAuthUser } from '../lib/supabase';
import { formatDuration } from '../lib/format';
import { goToTab } from '../lib/tabNav';

const SHARE_STYLES = [
  { id: 'cinematic',      label: '🎬 Cinematic',      desc: 'Golden hour · glowing route · sports ad' },
  { id: 'cyberpunk',      label: '🤖 Cyberpunk',       desc: 'Neon city · rain · electric blue trails' },
  { id: 'vintage_poster', label: '📋 Vintage Poster',  desc: '1970s race poster · bold flat graphics' },
  { id: 'comic',          label: '💥 Comic',            desc: 'Bold ink · speed lines · action hero' },
  { id: 'watercolour',    label: '🎨 Watercolour',     desc: 'Painterly · loose brushwork · fine art' },
  { id: 'olympic',        label: '🏅 Champion',          desc: 'Gold light · deep blue sky · elite athlete' },
  { id: 'fantasy',        label: '⚔️ Fantasy',          desc: 'Epic landscape · magical glowing path' },
  { id: 'anime',          label: '⚡ Anime',             desc: 'Speed lines · energy aura · iconic' },
  { id: 'cherry_blossom', label: '🌸 Cherry Blossom',   desc: 'Pink petals · dreamy spring light' },
  { id: 'surprise',       label: '🎲 Surprise me', desc: 'Different every time — roll the dice' },
];

// Progress theatre shown over the photo while the AI works (~30-50s), ChatGPT-style.
// Messages advance every few seconds and hold on the last one until the image lands.
const LOADING_MESSAGES = [
  'Reading your route…',
  'Scouting the scene…',
  'Mixing the colour grade…',
  'Repainting the sky…',
  'Burning your route into the ground…',
  'Adding the statistics…',
  'Adding the RIVAL glow…',
  'Rendering the final image…',
];

type Activity = {
  id: string; name: string | null; activity_type: string;
  distance_meters: number; duration_seconds: number;
  elevation_meters: number | null; effort_score: number;
  route_polyline: string | null; started_at: string;
  photo_url: string | null;
  exercises: { name: string; sets?: number; reps?: number; weight?: number }[] | null;
};

// Lifts live on the activity as a JSON column (activities.exercises). `idx` is the
// entry's position in that original array — what we pass to the function to select it.
type Lift = { idx: number; name: string; weight?: number; reps?: number; sets?: number };

export default function AiShareScreen() {
  const { activityId } = useLocalSearchParams<{ activityId: string }>();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [style, setStyle] = useState(SHARE_STYLES[0]);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [activityPhotos, setActivityPhotos] = useState<string[]>([]);
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const [loadingCaption, setLoadingCaption] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  // Composited (countdown-stamped) preview — shown before the user confirms the
  // download, so nothing saves silently without them seeing the result first.
  const [stampedPreviewUrl, setStampedPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lifts, setLifts] = useState<Lift[]>([]);
  const [selectedLiftIdx, setSelectedLiftIdx] = useState<number | null>(null);
  // Remembers the last "Surprise Me" variant so the next roll is guaranteed different.
  const [lastSurprise, setLastSurprise] = useState<number | null>(null);
  // Upcoming races (soonest first) for the countdown stamp. Multi-select:
  // one race = hero countdown, several = stacked countdown rows on one stamp.
  const [upcomingRaces, setUpcomingRaces] = useState<{ id: string; name: string; race_type: string; race_date: string }[]>([]);
  const [selectedRaceIds, setSelectedRaceIds] = useState<string[]>([]);
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  const [quotaResetAt, setQuotaResetAt] = useState<string | null>(null);

  // Loading-overlay theatre: cycling message + pulsing sparkle + sweeping bar.
  // (useNativeDriver: false — react-native-web doesn't support the native driver.)
  const scrollRef = useRef<ScrollView>(null);
  // Phone: the RIVAL look, and real icons in place of emoji. The flow and
  // every action are the same on both layouts.
  const { width: windowWidth } = useWindowDimensions();
  const mob = !sidePageWide(windowWidth);
  const em = (t: string) => (mob ? t.replace(/^[^\p{L}\p{N}]+/u, '').trim() : t);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
  const msgOpacity = useRef(new Animated.Value(1)).current;
  const sparklePulse = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const [trackW, setTrackW] = useState(0);

  useEffect(() => {
    if (!generating) return;
    setLoadingMsgIdx(0);
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(sparklePulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.timing(sparklePulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
    ]));
    const bar = Animated.loop(Animated.timing(sweep, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }));
    pulse.start();
    bar.start();
    const interval = setInterval(() => {
      Animated.timing(msgOpacity, { toValue: 0, duration: 220, useNativeDriver: false }).start(() => {
        setLoadingMsgIdx(i => Math.min(i + 1, LOADING_MESSAGES.length - 1));
        Animated.timing(msgOpacity, { toValue: 1, duration: 220, useNativeDriver: false }).start();
      });
    }, 6000);
    return () => {
      pulse.stop(); bar.stop(); clearInterval(interval);
      sparklePulse.setValue(0); sweep.setValue(0); msgOpacity.setValue(1);
    };
  }, [generating]);

  useFocusEffect(useCallback(() => { if (activityId) { loadActivity(); loadQuota(); loadRaces(); } }, [activityId]));

  async function loadRaces() {
    const { data: { user } } = await getAuthUser();
    if (!user) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from('races')
      .select('id, name, race_type, race_date')
      .eq('user_id', user.id)
      .gte('race_date', today.toISOString().slice(0, 10))
      .order('race_date', { ascending: true });
    setUpcomingRaces(data ?? []);
  }

  async function loadQuota() {
    const { data: { user } } = await getAuthUser();
    if (!user) return;
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, data: rows } = await supabase
      .from('ai_generations')
      .select('created_at', { count: 'exact' })
      .eq('user_id', user.id)
      .gte('created_at', dayAgo)
      .order('created_at', { ascending: true });
    const used = count ?? 0;
    const remaining = Math.max(0, 2 - used);
    setQuotaRemaining(remaining);
    if (remaining === 0 && rows && rows.length > 0) {
      const resetDate = new Date(new Date(rows[0].created_at).getTime() + 24 * 60 * 60 * 1000);
      setQuotaResetAt(resetDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
    }
  }

  async function loadActivity() {
    // The route is private to its owner and lives in its own table
    // (supabase/private_routes.sql); row-level security returns it only for
    // the person's own activity.
    const [{ data }, { data: routeRow }] = await Promise.all([
      supabase
        .from('activities')
        .select('id, name, activity_type, distance_meters, duration_seconds, elevation_meters, effort_score, started_at, photo_url, exercises')
        .eq('id', activityId).single(),
      supabase.from('activity_routes').select('polyline').eq('activity_id', activityId).maybeSingle(),
    ]);
    if (data) setActivity({ ...(data as any), route_polyline: routeRow?.polyline ?? null } as Activity);

    // Pull the photos already attached to this activity (the activity's own photo_url
    // plus any images in activity_media) so they're pre-loaded — no re-upload needed.
    const { data: media } = await supabase
      .from('activity_media')
      .select('media_url, media_type')
      .eq('activity_id', activityId);
    const photoUrls = [
      ...((data as any)?.photo_url ? [(data as any).photo_url as string] : []),
      ...((media ?? []).filter((m: any) => m.media_type === 'photo').map((m: any) => m.media_url as string)),
    ].filter((v, i, a) => !!v && a.indexOf(v) === i); // dedupe
    if (photoUrls.length > 0) {
      setActivityPhotos(photoUrls);
      // Auto-select the first so the user can generate straight away.
      setSelectedPhotoUrl(photoUrls[0]);
      setPhotoPreview(photoUrls[0]);
      setPhotoBase64(null);
    }

    // Lift breakdown is a JSON column on the activity. Build the picker list from it,
    // keeping each entry's original index so we can tell the function which to feature.
    // Sorted heaviest-first for display; heaviest is the default selection.
    const raw: any[] = Array.isArray((data as any)?.exercises) ? (data as any).exercises : [];
    const liftList: Lift[] = raw
      .map((ex, idx) => ({ idx, name: ex?.name, weight: ex?.weight, reps: ex?.reps, sets: ex?.sets }))
      .filter(l => !!l.name)
      .sort((a, b) => Number(b.weight ?? 0) - Number(a.weight ?? 0));
    if (liftList.length > 0) {
      setLifts(liftList);
      setSelectedLiftIdx(liftList[0].idx);
    }
  }

  async function generateCaption() {
    if (!activity) return;
    setLoadingCaption(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const distanceKm = activity.distance_meters ? (activity.distance_meters / 1000).toFixed(1) : null;
      const durationMin = activity.duration_seconds ? Math.round(activity.duration_seconds / 60) : null;
      const res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/generate-share-caption`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}`, 'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY! },
        body: JSON.stringify({ activityType: activity.activity_type, distanceKm, durationMin, elevationM: activity.elevation_meters }),
      });
      const data = await res.json();
      setCaption(data.caption ?? null);
    } finally { setLoadingCaption(false); }
  }

  function pickPhoto() {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setPhotoPreview(dataUrl);
        setPhotoBase64(dataUrl);
        setSelectedPhotoUrl(null); // an uploaded photo overrides any existing selection
        setGeneratedUrl(null); setStampedPreviewUrl(null);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  function selectExistingPhoto(url: string) {
    setSelectedPhotoUrl(url);
    setPhotoPreview(url);
    setPhotoBase64(null); // use the existing photo by URL — no re-upload
    setGeneratedUrl(null); setStampedPreviewUrl(null);
  }

  async function generate() {
    if (!photoBase64 && !selectedPhotoUrl) { setError('Add a photo first.'); return; }
    if (!activityId) return;
    setError(null);
    setGenerating(true);
    setGeneratedUrl(null); setStampedPreviewUrl(null);
    // The result lands in the photo preview frame at the top — bring it into view.
    scrollRef.current?.scrollTo({ y: 0, animated: true });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Two-image method: base photo + a route reference. Named styles send the
      // flat top-down map (the config that worked from day one); the
      // scene-replacement styles (Surprise Me, Cherry Blossom) send the
      // pre-projected perspective tracing template instead (see renderRouteMap) —
      // they rebuild the whole scene and can't re-project a flat map themselves.
      // NOTE: an experiment sent the template for ALL styles + piled on prompt
      // constraints; compliance collapsed (hallucinated stats/branding). Reverted.
      const routePerspective = style.id === 'surprise' || style.id === 'cherry_blossom';
      const routeImageBase64 = activity?.route_polyline ? renderRouteMap(activity.route_polyline, routePerspective) : null;

      const res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/generate-share-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}`, 'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY! },
        body: JSON.stringify({ activityId, style: style.id, photoBase64: selectedPhotoUrl ? null : photoBase64, photoUrl: selectedPhotoUrl, caption, routeImageBase64, routePerspective, exerciseIndex: selectedLiftIdx, surpriseExclude: style.id === 'surprise' ? lastSurprise : null }),
      });
      const data = await res.json();
      if (res.status === 429) {
        setQuotaRemaining(0);
        if (data.resetAt) {
          const resetDate = new Date(data.resetAt);
          setQuotaResetAt(resetDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
        }
        setError(data.error ?? 'Daily limit reached');
        return;
      }
      if (!res.ok || data.error) { setError(data.error ?? 'Generation failed'); return; }

      // Remember which surprise variant we got so the next roll excludes it.
      if (typeof data.surpriseIndex === 'number') setLastSurprise(data.surpriseIndex);
      if (typeof data.remaining === 'number') setQuotaRemaining(data.remaining);

      // Show the raw image immediately so the user isn't waiting blind,
      // then fire the upscale call and swap to the hi-res result.
      setGeneratedUrl(data.rawUrl);

      const upRes = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/upscale-share-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}`, 'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY! },
        body: JSON.stringify({ rawUrl: data.rawUrl, activityId }),
      });
      const upData = await upRes.json();
      if (upData.upscaleError) {
        // The image shown is the raw 1024x1536 — fine on a laptop, soft when a phone
        // stretches it full-screen. Surface it so nobody unknowingly saves a raw.
        console.warn('Upscale failed:', upData.upscaleError);
        setError(`HD enhancement failed. The image was saved at standard quality. (${upData.upscaleError})`);
      }
      // backgroundUrl is fal's 4x result (4096x3072-ish, ~38MB PNG) — shrink it to a
      // phone-friendly 2048-wide JPEG before showing/saving.
      if (upData.backgroundUrl) setGeneratedUrl(await shrinkToShareSize(upData.backgroundUrl));
    } catch (e) {
      setError('Could not reach the server. Try again.');
    } finally {
      setGenerating(false);
    }
  }

  function renderRouteMap(polyline: string, perspective = false): string | null {
    // Clean top-down route map (orange line on white) — the reference image we
    // hand the AI as the SECOND input so it projects the EXACT route shape.
    // With perspective=true (Surprise Me), we instead render a TRACING TEMPLATE:
    // a portrait canvas matching the generated image's frame (1024x1536) with the
    // route ALREADY foreshortened onto a ground plane — wide/thick at the bottom
    // edge, converging thin toward the horizon. The heavy scene-replacement
    // variants can't reliably re-project a top-down map themselves; copying a
    // pre-projected line is a much easier task, so shape AND placement both hold.
    if (Platform.OS !== 'web') return null;
    const pts = decodePolyline(polyline);
    if (pts.length < 2) return null;

    if (perspective) {
      const W = 1024, H = 1536;
      const canvas = document.createElement('canvas') as HTMLCanvasElement;
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);

      const lats = pts.map(p => p[0]), lngs = pts.map(p => p[1]);
      const minLat = Math.min(...lats), maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
      const spanLat = maxLat - minLat || 1e-6;
      const spanLng = maxLng - minLng || 1e-6;

      // Same 1/Z ground-plane math as drawGroundRoute: screen offset from the
      // horizon scales with ZNEAR/Z so distance compresses near the horizon.
      // NOTE: this is the lean winning-era config. A later experiment added a
      // sky tint + horizon line + normalized vertical mapping + hero/priority
      // prompt rules; the accumulated constraints collapsed model compliance
      // (hallucinated stats, ignored branding) and it was all stripped back.
      const HORIZON_Y = H * 0.30, NEAR_Y = H * 0.97;
      const CX = W * 0.5, NEAR_HALFW = W * 0.48;
      const ZNEAR = 1, ZFAR = 5.5;
      const proj = (lat: number, lng: number) => {
        const nx = (lng - minLng) / spanLng;
        const ny = (lat - minLat) / spanLat; // 0 = near (foreground), 1 = far
        const p = ZNEAR / (ZNEAR + ny * (ZFAR - ZNEAR));
        return { x: CX + (nx - 0.5) * 2 * NEAR_HALFW * p, y: HORIZON_Y + (NEAR_Y - HORIZON_Y) * p, p };
      };
      const sp = pts.map(p => proj(p[0], p[1]));

      // Per-segment stroke so the line width tapers with distance too.
      ctx.strokeStyle = '#FF5A1F';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const BASE_WIDTH = W * 0.04;
      for (let i = 1; i < sp.length; i++) {
        ctx.beginPath();
        ctx.moveTo(sp[i - 1].x, sp[i - 1].y);
        ctx.lineTo(sp[i].x, sp[i].y);
        ctx.lineWidth = Math.max(3, BASE_WIDTH * ((sp[i - 1].p + sp[i].p) / 2));
        ctx.stroke();
      }
      return canvas.toDataURL('image/png');
    }

    const lats = pts.map(p => p[0]), lngs = pts.map(p => p[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const spanLat = maxLat - minLat || 1e-6;
    const spanLng = maxLng - minLng || 1e-6;

    // Preserve the route's real aspect ratio (lng scaled by cos(lat) for accuracy)
    const midLat = (minLat + maxLat) / 2;
    const aspect = (spanLng * Math.cos(midLat * Math.PI / 180)) / spanLat;
    const BASE = 1024, PAD = 90;
    const inner = BASE - PAD * 2;
    const W = aspect >= 1 ? BASE : Math.round(inner * aspect + PAD * 2);
    const H = aspect >= 1 ? Math.round(inner / aspect + PAD * 2) : BASE;

    const canvas = document.createElement('canvas') as HTMLCanvasElement;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);

    const toXY = (lat: number, lng: number) => ({
      x: PAD + ((lng - minLng) / spanLng) * (W - PAD * 2),
      y: (H - PAD) - ((lat - minLat) / spanLat) * (H - PAD * 2),
    });

    ctx.strokeStyle = '#FF5A1F';
    ctx.lineWidth = 16;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const sp = pts.map(p => toXY(p[0], p[1]));
    ctx.moveTo(sp[0].x, sp[0].y);
    for (let i = 1; i < sp.length - 1; i++) {
      const mx = (sp[i].x + sp[i + 1].x) / 2, my = (sp[i].y + sp[i + 1].y) / 2;
      ctx.quadraticCurveTo(sp[i].x, sp[i].y, mx, my);
    }
    ctx.lineTo(sp[sp.length - 1].x, sp[sp.length - 1].y);
    ctx.stroke();

    return canvas.toDataURL('image/png');
  }

  function decodePolyline(encoded: string): [number, number][] {
    // Google encoded polyline → [[lat, lng], ...]
    const points: [number, number][] = [];
    let idx = 0, lat = 0, lng = 0;
    while (idx < encoded.length) {
      let b, shift = 0, result = 0;
      do { b = encoded.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lat += result & 1 ? ~(result >> 1) : result >> 1;
      shift = 0; result = 0;
      do { b = encoded.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lng += result & 1 ? ~(result >> 1) : result >> 1;
      points.push([lat / 1e5, lng / 1e5]);
    }
    return points;
  }

  function drawGroundRoute(ctx: CanvasRenderingContext2D, W: number, H: number, polyline: string) {
    const pts = decodePolyline(polyline);
    if (pts.length < 2) return;

    const lats = pts.map(p => p[0]), lngs = pts.map(p => p[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

    // ── Ground-plane perspective (hyperbolic foreshortening) ──────────────
    // Far end of the route converges to a low horizon sitting ON the grass;
    // the foreground spreads wide. Screen offset from the horizon scales with
    // 1/Z (real camera perspective) so distance compresses near the horizon —
    // the route lies FLAT on the ground instead of rising up the frame.
    const HORIZON_Y  = H * 0.55;   // where the far end converges (on the field)
    const NEAR_Y     = H * 0.96;   // nearest (foreground) route point
    const NEAR_HALFW = W * 0.60;   // half-width of the route spread up close
    const CX         = W * 0.52;
    const ZNEAR = 1, ZFAR = 6.5;

    // Clip anything above the horizon so nothing paints into the sky/people.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HORIZON_Y - H * 0.02, W, H);
    ctx.clip();

    const toScreen = (lat: number, lng: number) => {
      const nx = (maxLng - minLng) > 0 ? (lng - minLng) / (maxLng - minLng) : 0.5;
      // ny: 0 = near (foreground), 1 = far (toward horizon)
      const ny = (maxLat - minLat) > 0 ? (lat - minLat) / (maxLat - minLat) : 0.5;
      const Z = ZNEAR + ny * (ZFAR - ZNEAR);
      const p = ZNEAR / Z;                       // 1 near … small far
      const sy = HORIZON_Y + (NEAR_Y - HORIZON_Y) * p;
      const sx = CX + (nx - 0.5) * 2 * NEAR_HALFW * p;
      return { x: sx, y: sy };
    };

    const sp = pts.map(p => toScreen(p[0], p[1]));

    // Smooth flowing curve through the points (quadratic through midpoints)
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(sp[0].x, sp[0].y);
      for (let i = 1; i < sp.length - 1; i++) {
        const mx = (sp[i].x + sp[i + 1].x) / 2;
        const my = (sp[i].y + sp[i + 1].y) / 2;
        ctx.quadraticCurveTo(sp[i].x, sp[i].y, mx, my);
      }
      ctx.lineTo(sp[sp.length - 1].x, sp[sp.length - 1].y);
    };

    // Softer, warmer glow — visible enough for the AI to keep the shape, but
    // no harsh white core, so the AI embeds it with real light spill.
    const passes = [
      { alpha: 0.22, color: '#FF6A00', width: W * 0.050, blur: W * 0.045 }, // warm haze
      { alpha: 0.45, color: '#FF9A2E', width: W * 0.018, blur: W * 0.020 }, // amber glow
      { alpha: 0.80, color: '#FFC66B', width: W * 0.007, blur: W * 0.008 }, // warm core
    ];
    passes.forEach(({ alpha, color, width, blur }) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.shadowColor = color; ctx.shadowBlur = blur;
      path(); ctx.stroke();
      ctx.restore();
    });

    ctx.restore(); // remove clip
  }

  function applyStyleFilter(ctx: CanvasRenderingContext2D, W: number, H: number, styleId: string) {
    const s = styleId || 'cinematic';

    if (s === 'cinematic') {
      // Warm golden-hour grade: amber multiply + sun glow screen
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      const warm = ctx.createLinearGradient(0, 0, 0, H);
      warm.addColorStop(0,   'rgba(220, 100, 20, 0.38)');
      warm.addColorStop(0.4, 'rgba(255, 150, 40, 0.22)');
      warm.addColorStop(1,   'rgba(180, 60, 10, 0.42)');
      ctx.fillStyle = warm; ctx.fillRect(0, 0, W, H);
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const sun = ctx.createRadialGradient(W * 0.35, H * 0.18, 0, W * 0.35, H * 0.18, W * 0.7);
      sun.addColorStop(0,   'rgba(255, 210, 100, 0.40)');
      sun.addColorStop(0.4, 'rgba(255, 150, 50, 0.18)');
      sun.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H);
      ctx.restore();

    } else if (s === 'cyberpunk') {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      const cool = ctx.createLinearGradient(0, 0, 0, H);
      cool.addColorStop(0,   'rgba(10, 10, 60, 0.55)');
      cool.addColorStop(1,   'rgba(60, 0, 80, 0.45)');
      ctx.fillStyle = cool; ctx.fillRect(0, 0, W, H);
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const neon = ctx.createRadialGradient(W * 0.5, H, 0, W * 0.5, H, W * 0.9);
      neon.addColorStop(0,   'rgba(0, 200, 255, 0.28)');
      neon.addColorStop(0.5, 'rgba(180, 0, 255, 0.12)');
      neon.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = neon; ctx.fillRect(0, 0, W, H);
      ctx.restore();

    } else if (s === 'vintage_poster') {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgba(180, 120, 30, 0.45)';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = 'rgba(255, 240, 180, 0.15)';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();

    } else if (s === 'olympic') {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      const gold = ctx.createLinearGradient(0, 0, 0, H);
      gold.addColorStop(0,   'rgba(10, 20, 60, 0.50)');
      gold.addColorStop(1,   'rgba(180, 120, 0, 0.35)');
      ctx.fillStyle = gold; ctx.fillRect(0, 0, W, H);
      ctx.restore();

    } else if (s === 'fantasy') {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      const mag = ctx.createLinearGradient(0, 0, 0, H);
      mag.addColorStop(0,   'rgba(20, 0, 60, 0.50)');
      mag.addColorStop(1,   'rgba(80, 10, 100, 0.40)');
      ctx.fillStyle = mag; ctx.fillRect(0, 0, W, H);
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const glow = ctx.createRadialGradient(W * 0.5, H * 0.3, 0, W * 0.5, H * 0.3, W * 0.6);
      glow.addColorStop(0,   'rgba(160, 80, 255, 0.25)');
      glow.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
      ctx.restore();

    } else {
      // Default warm grade for all other styles
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgba(200, 100, 20, 0.30)';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  async function compositeImage(
    photoUrl: string,
    stats: { distanceKm: string | null; durationMin: number | null; elevationM: number | null; pace: string | null } | null,
  ): Promise<string> {
    if (Platform.OS !== 'web') return photoUrl;

    const loadImage = (url: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
      const img = document.createElement('img') as HTMLImageElement;
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });

    try {
      const photo = await loadImage(photoUrl);

      const W = photo.naturalWidth || 1080;
      const H = photo.naturalHeight || 1440;
      const canvas = document.createElement('canvas') as HTMLCanvasElement;
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

      // AI-generated scene — route embedded by AI using the route shape reference image
      ctx.drawImage(photo, 0, 0, W, H);

      // ── Stage 5: Dark gradient — bottom only, for stat legibility ────────
      const grad = ctx.createLinearGradient(0, H * 0.70, 0, H);
      grad.addColorStop(0,    'rgba(0,0,0,0)');
      grad.addColorStop(0.40, 'rgba(0,0,0,0.75)');
      grad.addColorStop(1,    'rgba(0,0,0,0.96)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, H * 0.70, W, H * 0.30);

      const pad = W * 0.07;
      const distanceKm = stats?.distanceKm ?? (activity?.distance_meters ? (activity.distance_meters / 1000).toFixed(2) : null);
      const durationMin = stats?.durationMin ?? (activity?.duration_seconds ? Math.round(activity.duration_seconds / 60) : null);
      const elev = stats?.elevationM ?? (activity?.elevation_meters ? Math.round(activity.elevation_meters) : null);
      const pace = stats?.pace ?? null;
      // Clock format ("39:24", "1:23:45") — a bare "39m" under Time reads as metres
      const stampSec = activity?.duration_seconds ?? (durationMin != null ? durationMin * 60 : null);
      const durationFormatted = stampSec != null
        ? (stampSec >= 3600
            ? `${Math.floor(stampSec / 3600)}:${String(Math.floor((stampSec % 3600) / 60)).padStart(2, '0')}:${String(Math.round(stampSec % 60)).padStart(2, '0')}`
            : `${Math.floor(stampSec / 60)}:${String(Math.round(stampSec % 60)).padStart(2, '0')}`)
        : null;

      // ── Stats — Strava-style: label small italic above, value large bold ──
      // Laid out left→right with dividers between each stat
      const statItems: { label: string; value: string }[] = [];
      if (distanceKm) statItems.push({ label: 'Distance', value: `${distanceKm} km` });
      if (elev) statItems.push({ label: 'Elev Gain', value: `${elev} m` });
      if (durationFormatted) statItems.push({ label: 'Time', value: durationFormatted });
      if (pace) statItems.push({ label: 'Pace', value: pace });

      const labelSize = Math.round(W * 0.024);
      const valueSize = Math.round(W * 0.050);
      const statsBaseY = H * 0.845;

      // Measure each stat value so we can space them properly
      ctx.font = `900 ${valueSize}px -apple-system, sans-serif`;
      const measured = statItems.map(s => ctx.measureText(s.value).width);
      const totalStatW = measured.reduce((a, b) => a + b, 0) + (statItems.length - 1) * (W * 0.06);
      let curX = pad;

      statItems.forEach((s, i) => {
        // Divider before each stat after the first
        if (i > 0) {
          ctx.save();
          ctx.strokeStyle = 'rgba(255,255,255,0.28)';
          ctx.lineWidth = 1.5;
          ctx.shadowBlur = 0;
          ctx.beginPath();
          ctx.moveTo(curX - W * 0.03, statsBaseY - valueSize * 1.1);
          ctx.lineTo(curX - W * 0.03, statsBaseY + valueSize * 0.1);
          ctx.stroke();
          ctx.restore();
        }

        // Label — small italic
        ctx.textAlign = 'left';
        ctx.font = `italic 600 ${labelSize}px -apple-system, sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.62)';
        ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 5;
        ctx.fillText(s.label, curX, statsBaseY - valueSize * 0.18);

        // Value — bold white
        ctx.font = `900 ${valueSize}px -apple-system, sans-serif`;
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 8;
        ctx.fillText(s.value, curX, statsBaseY + valueSize * 0.82);
        ctx.shadowBlur = 0;

        curX += measured[i] + W * 0.06;
      });

      // ── RIVAL wordmark — bottom left, glowing pink ─────────────────────
      const rivalSize = Math.round(W * 0.068);
      const rivalY = H * 0.945;
      ctx.textAlign = 'left';
      ctx.font = `900 ${rivalSize}px -apple-system, sans-serif`;
      ctx.fillStyle = '#E91E8C';
      ctx.shadowColor = '#E91E8C'; ctx.shadowBlur = 20;
      ctx.fillText('RIVAL', pad, rivalY);
      ctx.shadowBlur = 0;

      // rival.app tag — right of wordmark
      ctx.font = `500 ${Math.round(W * 0.024)}px -apple-system, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.38)';
      const rivalTagX = pad + ctx.measureText('RIVAL').width + W * 0.03;
      // measure font was small — re-measure RIVAL at rivalSize
      ctx.font = `900 ${rivalSize}px -apple-system, sans-serif`;
      const rivalW = ctx.measureText('RIVAL').width;
      ctx.font = `500 ${Math.round(W * 0.024)}px -apple-system, sans-serif`;
      ctx.fillText('rival.app', pad + rivalW + W * 0.025, rivalY);

      // ── Caption (optional) ──────────────────────────────────────────────
      if (caption) {
        ctx.textAlign = 'center';
        ctx.font = `italic ${Math.round(W * 0.028)}px Georgia, serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
        ctx.fillText(`"${caption}"`, W / 2, H * 0.972);
        ctx.shadowBlur = 0;
      }

      return canvas.toDataURL('image/jpeg', 0.93);
    } catch (e) {
      console.error('Composite failed:', e);
      return photoUrl;
    }
  }

  async function shrinkToShareSize(url: string): Promise<string> {
    // The upscaler hands back a 4x PNG (fal requires upscale_factor: 4 — huge file).
    // Downscale to 2048-wide JPEG: still 2x the raw render (sharp on any phone),
    // ~2MB instead of ~38MB, and 4x-then-downsample beats a native 2x for detail.
    if (Platform.OS !== 'web') return url;
    try {
      const img = document.createElement('img') as HTMLImageElement;
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('image load failed'));
        img.src = url;
      });
      const scale = Math.min(1, 2048 / img.naturalWidth);
      if (scale === 1) return url;
      const canvas = document.createElement('canvas') as HTMLCanvasElement;
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.92);
    } catch {
      // CORS/tainted canvas or fetch hiccup — the 4x URL still displays fine as-is.
      return url;
    }
  }

  async function downloadImage() {
    if (!generatedUrl || Platform.OS !== 'web') return;
    try {
      // Fetch as a blob so the download attribute works on cross-origin URLs
      // (otherwise the browser just navigates to the image instead of saving).
      const resp = await fetch(generatedUrl);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rival-${activity?.activity_type ?? 'workout'}-${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // Last-resort fallback: open in a new tab so nothing navigates away
      window.open(generatedUrl, '_blank');
    }
  }

  // Shared by generateStamp() so it draws identical,
  // deterministic (non-AI) stats — no hallucination risk either way.
  function getStampStats(): { activityLabel: string; stats: { label: string; value: string }[] } | null {
    if (!activity) return null;

    const t = activity.activity_type.toLowerCase();
    const category =
      t.includes('swim') ? 'swim'
      : (t.includes('ride') || t.includes('cycl') || t.includes('bike') || t.includes('handcycle')) ? 'cycle'
      : (t.includes('row') || t.includes('kayak') || t.includes('canoe') || t.includes('paddl') || t.includes('surf')) ? 'water'
      : (t.includes('weight') || t.includes('strength') || t.includes('workout') || t.includes('yoga') || t.includes('crossfit') || t.includes('pilates') || t.includes('elliptical') || t.includes('stair') || t.includes('hiit')) ? 'strength'
      : 'foot';

    const activityLabel = activity.activity_type.replace(/([a-z])([A-Z])/g, '$1 $2').trim().toUpperCase() || 'WORKOUT';
    const distanceM = activity.distance_meters;
    const distanceKm = distanceM ? (distanceM / 1000).toFixed(2) : null;
    const durationSec = activity.duration_seconds;
    const durationMin = durationSec ? Math.round(durationSec / 60) : null;
    const elevationM = activity.elevation_meters ? Math.round(activity.elevation_meters) : null;
    const durationFormatted = durationSec != null
      ? (durationSec >= 3600
          ? `${Math.floor(durationSec / 3600)}:${String(Math.floor((durationSec % 3600) / 60)).padStart(2, '0')}:${String(Math.round(durationSec % 60)).padStart(2, '0')}`
          : `${Math.floor(durationSec / 60)}:${String(Math.round(durationSec % 60)).padStart(2, '0')}`)
      : null;
    const mmss = (totalMin: number, unit: string) =>
      `${Math.floor(totalMin)}:${String(Math.round((totalMin % 1) * 60)).padStart(2, '0')}${unit}`;
    const paceMinKm = distanceKm && durationMin ? mmss(durationMin / parseFloat(distanceKm), '/km') : null;
    const speedKmh = distanceM && durationSec ? `${(distanceM / 1000 / (durationSec / 3600)).toFixed(1)} km/h` : null;
    const pace100m = distanceM && durationSec ? mmss((durationSec / (distanceM / 100)) / 60, '/100m') : null;

    const featuredLift = lifts.find(l => l.idx === selectedLiftIdx) ?? lifts[0] ?? null;

    const stats: { label: string; value: string }[] =
      category === 'strength' ? (featuredLift ? [
        ...(featuredLift.weight ? [{ label: featuredLift.name, value: `${featuredLift.weight} kg` }] : [{ label: 'Workout', value: featuredLift.name }]),
        ...(featuredLift.reps ? [{ label: 'Reps', value: `${featuredLift.reps}` }] : []),
        ...(durationFormatted ? [{ label: 'Time', value: durationFormatted }] : []),
      ] : [
        ...(durationFormatted ? [{ label: 'Time', value: durationFormatted }] : []),
      ]) : category === 'swim' ? [
        ...(distanceM ? [{ label: 'Distance', value: `${distanceM} m` }] : []),
        ...(pace100m ? [{ label: 'Pace', value: pace100m }] : []),
        ...(durationFormatted ? [{ label: 'Time', value: durationFormatted }] : []),
      ] : category === 'water' ? [
        ...(distanceKm ? [{ label: 'Distance', value: `${distanceKm} km` }] : []),
        ...(speedKmh ? [{ label: 'Speed', value: speedKmh }] : []),
        ...(durationFormatted ? [{ label: 'Time', value: durationFormatted }] : []),
      ] : category === 'cycle' ? [
        ...(distanceKm ? [{ label: 'Distance', value: `${distanceKm} km` }] : []),
        ...(speedKmh ? [{ label: 'Speed', value: speedKmh }] : []),
        ...(durationFormatted ? [{ label: 'Time', value: durationFormatted }] : []),
        ...(elevationM ? [{ label: 'Elevation', value: `${elevationM} m` }] : []),
      ] : [
        ...(distanceKm ? [{ label: 'Distance', value: `${distanceKm} km` }] : []),
        ...(paceMinKm ? [{ label: 'Pace', value: paceMinKm }] : []),
        ...(durationFormatted ? [{ label: 'Time', value: durationFormatted }] : []),
        ...(elevationM ? [{ label: 'Elevation', value: `${elevationM} m` }] : []),
      ];

    return { activityLabel, stats };
  }

  function generateStamp() {
    if (!activity || Platform.OS !== 'web') return;
    const result = getStampStats();
    if (!result) return;
    const { activityLabel, stats } = result;

    const W = 480;
    const PAD = 36;
    const LABEL_H = 14;
    const VALUE_H = 34;
    const ROW_GAP = 20;
    const ACTIVITY_H = 18;
    const RIVAL_H = 40;
    const H = PAD + ACTIVITY_H + 20 + stats.length * (LABEL_H + 6 + VALUE_H + ROW_GAP) + 16 + RIVAL_H + PAD;

    const canvas = document.createElement('canvas') as HTMLCanvasElement;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, W, H);

    let y = PAD;

    // Activity type
    ctx.textAlign = 'left';
    ctx.font = `700 ${ACTIVITY_H}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillStyle = '#E91E8C';
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 8;
    ctx.fillText(activityLabel, PAD, y + ACTIVITY_H);
    y += ACTIVITY_H + 20;

    // Stats rows
    stats.forEach(s => {
      ctx.font = `600 ${LABEL_H}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 6;
      ctx.fillText(s.label.toUpperCase(), PAD, y + LABEL_H);
      y += LABEL_H + 6;

      ctx.font = `900 ${VALUE_H}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 10;
      ctx.fillText(s.value, PAD, y + VALUE_H);
      y += VALUE_H + ROW_GAP;
    });

    y += 8;

    // RIVAL wordmark
    ctx.font = `900 ${RIVAL_H}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillStyle = '#E91E8C';
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 12;
    ctx.fillText('RIVAL', PAD, y + RIVAL_H * 0.8);

    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `rival-stamp-${activity.activity_type}-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Composites the race countdown as a compact TOP banner onto the finished AI
  // share image, flattened to one JPEG. Deliberately does NOT reuse the bottom-
  // heavy countdown layout or redraw the RIVAL wordmark — the AI image already
  // burns its own stats + RIVAL branding into the bottom third, so a second full
  // block down there would double up and clash. Top banner, one race only
  // (the hero one), stays purely additive instead of competing for the same
  // corner. Does not touch the generate() prompt in any way.
  async function stampCountdownOnGenerated() {
    if (!generatedUrl || Platform.OS !== 'web') return;
    const race = upcomingRaces.filter(r => selectedRaceIds.includes(r.id)).sort((a, b) => a.race_date.localeCompare(b.race_date))[0];
    if (!race) return;

    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not load generated image'));
      img.src = generatedUrl;
    });

    const W = img.naturalWidth || 1024;
    const H = img.naturalHeight || 1536;
    const canvas = document.createElement('canvas') as HTMLCanvasElement;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.drawImage(img, 0, 0, W, H);

    const days = daysUntil(race.race_date);
    const fmtDate = new Date(`${race.race_date.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
    const metaLine = [race.race_type?.trim() ? race.race_type.trim().toUpperCase() : null, fmtDate].filter(Boolean).join(' · ');
    const daysLine = days === 0 ? "EVENT DAY — LET'S GO" : `${days} ${days === 1 ? 'DAY' : 'DAYS'} TO ${race.name.toUpperCase()}`;

    const scale = W / 1024;
    const PAD_X = 28 * scale, PAD_Y = 18 * scale;
    const DAYS_H = 30 * scale, META_H = 13 * scale, GAP = 6 * scale;

    ctx.textAlign = 'left';
    ctx.font = `900 ${DAYS_H}px -apple-system, BlinkMacSystemFont, sans-serif`;
    const daysW = ctx.measureText(daysLine).width;
    ctx.font = `600 ${META_H}px -apple-system, BlinkMacSystemFont, sans-serif`;
    const metaW = metaLine ? ctx.measureText(metaLine).width : 0;
    const pillW = Math.min(W - PAD_X * 2, Math.max(daysW, metaW) + PAD_X * 2);
    const pillH = PAD_Y * 2 + DAYS_H + (metaLine ? GAP + META_H : 0);
    const pillX = (W - pillW) / 2;
    const pillY = 28 * scale;

    // Rounded pill scrim — a small top banner, not a full-width takeover.
    const r = 18 * scale;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.moveTo(pillX + r, pillY);
    ctx.arcTo(pillX + pillW, pillY, pillX + pillW, pillY + pillH, r);
    ctx.arcTo(pillX + pillW, pillY + pillH, pillX, pillY + pillH, r);
    ctx.arcTo(pillX, pillY + pillH, pillX, pillY, r);
    ctx.arcTo(pillX, pillY, pillX + pillW, pillY, r);
    ctx.closePath();
    ctx.fill();

    ctx.textAlign = 'center';
    let ty = pillY + PAD_Y;
    ctx.font = `900 ${DAYS_H}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 6 * scale;
    ctx.fillText(daysLine, pillX + pillW / 2, ty + DAYS_H * 0.82);
    ty += DAYS_H + GAP;

    if (metaLine) {
      ctx.font = `600 ${META_H}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 4 * scale;
      ctx.fillText(metaLine, pillX + pillW / 2, ty + META_H);
    }

    setStampedPreviewUrl(canvas.toDataURL('image/jpeg', 0.92));
  }

  function downloadStampedPreview() {
    if (!stampedPreviewUrl) return;
    const a = document.createElement('a');
    a.href = stampedPreviewUrl;
    a.download = `rival-share-countdown-${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function daysUntil(dateStr: string): number {
    const [y, m, d] = dateStr.split('-').map(Number);
    const race = new Date(y, m - 1, d);
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.ceil((race.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }

  function generateCountdownStamp() {
    // Transparent countdown stamp for upcoming races — same recipe as the stats
    // stamp: white text + drop shadows so it reads on any photo, RIVAL wordmark
    // for branding. One race = hero countdown; several = stacked countdown rows.
    if (Platform.OS !== 'web') return;
    const races = upcomingRaces
      .filter(r => selectedRaceIds.includes(r.id))
      .sort((a, b) => a.race_date.localeCompare(b.race_date));
    if (races.length === 0) return;

    const fmtDate = (d: string) =>
      new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
    // e.g. "HYROX · SAT 12 OCT" (type omitted if it's blank)
    const metaLine = (r: { race_type: string; race_date: string }) =>
      [r.race_type?.trim() ? r.race_type.trim().toUpperCase() : null, fmtDate(r.race_date)].filter(Boolean).join(' · ');

    const W = 480, PAD = 36, RIVAL_H = 40;
    const canvas = document.createElement('canvas') as HTMLCanvasElement;
    const single = races.length === 1;

    // Row metrics for the stacked (multi-race) layout
    const M_NAME = 22, M_META = 13, M_DAYS = 40, M_GAP = 26;

    const NAME_MAX = 26, META_H = 14, NUM_H = 120, SUB_H = 20;
    const H = single
      ? PAD + NAME_MAX + 10 + META_H + 26 + NUM_H + 8 + SUB_H + 26 + RIVAL_H + PAD
      : PAD + races.length * (M_NAME + 4 + M_META + 8 + M_DAYS + M_GAP) - M_GAP + 24 + RIVAL_H + PAD;

    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'left';

    // Shrink-to-fit helper: drops the font size until the text fits one line.
    const fitText = (text: string, weight: number, maxSize: number, minSize: number) => {
      let size = maxSize;
      ctx.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, sans-serif`;
      while (ctx.measureText(text).width > W - PAD * 2 && size > minSize) {
        size -= 1;
        ctx.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, sans-serif`;
      }
      return size;
    };

    let y = PAD;

    if (single) {
      const race = races[0];
      const days = daysUntil(race.race_date);
      const name = race.name.toUpperCase();

      const nameSize = fitText(name, 800, NAME_MAX, 15);
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 8;
      ctx.fillText(name, PAD, y + NAME_MAX - (NAME_MAX - nameSize) / 2);
      y += NAME_MAX + 10;

      ctx.font = `600 ${META_H}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 6;
      ctx.fillText(metaLine(race), PAD, y + META_H);
      y += META_H + 26;

      if (days === 0) {
        ctx.font = `900 64px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 12;
        ctx.fillText('EVENT DAY', PAD, y + NUM_H * 0.7);
        y += NUM_H + 8;
        ctx.font = `700 ${SUB_H}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.fillStyle = '#E91E8C';
        ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 8;
        ctx.fillText("LET'S GO", PAD, y + SUB_H);
      } else {
        ctx.font = `900 ${NUM_H}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 12;
        ctx.fillText(`${days}`, PAD, y + NUM_H * 0.82);
        y += NUM_H + 8;
        ctx.font = `700 ${SUB_H}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 6;
        ctx.fillText(days === 1 ? 'DAY TO GO' : 'DAYS TO GO', PAD, y + SUB_H);
      }
      y += SUB_H + 26;
    } else {
      races.forEach(race => {
        const days = daysUntil(race.race_date);
        const name = race.name.toUpperCase();

        const nameSize = fitText(name, 800, M_NAME, 14);
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 7;
        ctx.fillText(name, PAD, y + M_NAME - (M_NAME - nameSize) / 2);
        y += M_NAME + 4;

        ctx.font = `600 ${M_META}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 6;
        ctx.fillText(metaLine(race), PAD, y + M_META);
        y += M_META + 8;

        ctx.font = `900 ${M_DAYS}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 10;
        ctx.fillText(
          days === 0 ? 'EVENT DAY' : `${days} ${days === 1 ? 'DAY' : 'DAYS'} TO GO`,
          PAD, y + M_DAYS * 0.82,
        );
        y += M_DAYS + M_GAP;
      });
      y += 24 - M_GAP;
    }

    // RIVAL wordmark
    ctx.font = `900 ${RIVAL_H}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillStyle = '#E91E8C';
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 12;
    ctx.fillText('RIVAL', PAD, y + RIVAL_H * 0.8);

    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `rival-countdown-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function goBack() {
    // router.back() no-ops when there's no history (e.g. page refreshed on web).
    if (router.canGoBack()) router.back();
    else goToTab('/my-activities');
  }

  return (
    <SafeAreaView style={[styles.container, mob && ms.container]}>
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.content, mob && ms.content]}>
        {mob ? (
          <GreyPageHead kicker="SHARE" title="Share with AI" onBack={goBack} />
        ) : (
          <View style={styles.header}>
            <RivalBackButton onPress={goBack} color={RivalColors.accentFill} />
            <Text style={styles.title}>✨ AI Share</Text>
          </View>
        )}

        {activity && (
          <View style={[styles.activitySummary, mob && ms.card]}>
            <Text style={[styles.activityName, mob && rm.serifTitleSm]}>{activity.name || activity.activity_type}</Text>
            <Text style={styles.activityMeta}>
              {activity.distance_meters ? `${(activity.distance_meters / 1000).toFixed(2)} km · ` : ''}
              {activity.duration_seconds ? formatDuration(activity.duration_seconds) : ''}
              {activity.elevation_meters ? ` · ${Math.round(activity.elevation_meters)}m` : ''}
            </Text>
            {activity.route_polyline
              ? <Text style={styles.routeTag}>{em('✓ Route data will be used in the artwork')}</Text>
              : <Text style={styles.noRouteTag}>No route data. Sync a connected device to include a GPS route.</Text>
            }
          </View>
        )}

        {/* Lift picker — only when the session has more than one logged exercise */}
        {lifts.length > 1 && (
          <>
            <Text style={[styles.sectionLabel, mob && ms.sectionLabel]}>Featured lift</Text>
            <View style={styles.liftRow}>
              {lifts.map(l => (
                <TouchableOpacity
                  key={l.idx}
                  style={[styles.liftChip, mob && ms.chip, selectedLiftIdx === l.idx && styles.liftChipActive, mob && selectedLiftIdx === l.idx && ms.chipOn]}
                  onPress={() => { setSelectedLiftIdx(l.idx); setGeneratedUrl(null); setStampedPreviewUrl(null); }}
                >
                  <Text style={[styles.liftChipName, selectedLiftIdx === l.idx && styles.liftChipTextActive]}>{l.name}</Text>
                  <Text style={[styles.liftChipMeta, selectedLiftIdx === l.idx && styles.liftChipTextActive]}>
                    {l.weight ? `${l.weight}kg` : ''}{l.reps ? `${l.weight ? ' × ' : ''}${l.reps}` : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* Existing activity photos — pre-loaded, tap to use one */}
        {activityPhotos.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, mob && ms.sectionLabel]}>Your activity photo{activityPhotos.length > 1 ? 's' : ''}</Text>
            <View style={styles.activityPhotoRow}>
              {activityPhotos.map(url => (
                <TouchableOpacity
                  key={url}
                  style={[styles.activityPhotoThumb, mob && ms.thumb, selectedPhotoUrl === url && styles.activityPhotoThumbActive]}
                  onPress={() => selectExistingPhoto(url)}
                >
                  <Image source={{ uri: url }} style={styles.activityPhotoThumbImg} resizeMode="cover" />
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* Photo preview + picker — the generated result lands in this same frame,
            with a ChatGPT-style loading overlay while the AI works */}
        <TouchableOpacity
          style={[styles.photoPicker, mob && ms.picker, photoPreview && styles.photoPickerFilled]}
          onPress={pickPhoto}
          disabled={generating}
        >
          {photoPreview ? (
            <View style={styles.previewFrame}>
              <Image
                source={{ uri: stampedPreviewUrl ?? generatedUrl ?? photoPreview }}
                style={[styles.photoThumb, generatedUrl && styles.photoThumbResult]}
                resizeMode="contain"
              />
              {generating && !generatedUrl && (
                <View style={styles.loadingOverlay}>
                  {mob ? (
                    <Animated.View
                      style={{
                        opacity: sparklePulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
                        transform: [{ scale: sparklePulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.15] }) }],
                      }}
                    >
                      <RivalIcon name="ai" size={38} color={RivalColors.accentText} />
                    </Animated.View>
                  ) : (
                    <Animated.Text
                      style={[styles.loadingSparkle, {
                        opacity: sparklePulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
                        transform: [{ scale: sparklePulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.15] }) }],
                      }]}
                    >✨</Animated.Text>
                  )}
                  <Animated.Text style={[styles.loadingMsg, { opacity: msgOpacity }]}>
                    {LOADING_MESSAGES[loadingMsgIdx]}
                  </Animated.Text>
                  <View style={styles.loadingTrack} onLayout={e => setTrackW(e.nativeEvent.layout.width)}>
                    <Animated.View
                      style={[styles.loadingBar, {
                        transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-90, Math.max(trackW, 90)] }) }],
                      }]}
                    />
                  </View>
                  <Text style={styles.loadingSub}>Usually 30–45 seconds</Text>
                </View>
              )}
              {generating && generatedUrl && (
                <View style={styles.enhancePill}>
                  <ActivityIndicator color="#FFFFFF" size="small" />
                  <Text style={styles.enhancePillText}>Enhancing to HD…</Text>
                </View>
              )}
              {error && !generating && (
                <View style={styles.frameErrorOverlay}>
                  <Text style={styles.frameErrorText}>{error}</Text>
                </View>
              )}
            </View>
          ) : (
            <>
              {mob ? (
                <View style={rm.iconCircle}><RivalIcon name="addPhoto" size={20} color={RivalColors.accentText} /></View>
              ) : (
                <Text style={styles.photoPickerIcon}>📷</Text>
              )}
              <Text style={[styles.photoPickerText, mob && ms.pickerText]}>Add photo</Text>
              <Text style={styles.photoPickerSub}>The original photo is kept. AI restyles the scene around it.</Text>
            </>
          )}
        </TouchableOpacity>
        {photoPreview && !generating && (
          <TouchableOpacity onPress={pickPhoto} style={styles.changePhotoBtn}>
            <Text style={styles.changePhotoBtnText}>{activityPhotos.length > 0 ? 'Upload a different photo' : 'Change photo'}</Text>
          </TouchableOpacity>
        )}

        {/* Countdown-stamped preview — shown before saving so nothing downloads
            silently; user explicitly confirms or discards it. */}
        {stampedPreviewUrl && !generating && (
          <View style={styles.resultActions}>
            <TouchableOpacity style={mob ? rm.primary : styles.downloadBtn} onPress={downloadStampedPreview}>
              {mob && <RivalIcon name="upload" size={18} color={rm.primaryText.color as string} />}
              <Text style={mob ? rm.primaryText : styles.downloadBtnText}>{em('⬇ Save this version')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={mob ? rm.ghost : styles.regenerateBtn} onPress={() => setStampedPreviewUrl(null)}>
              <Text style={mob ? rm.ghostText : styles.regenerateBtnText}>{em('✕ Discard and restore original')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Result actions — right under the frame where the result appears */}
        {generatedUrl && !generating && !stampedPreviewUrl && (
          <View style={styles.resultActions}>
            <TouchableOpacity style={mob ? rm.primary : styles.downloadBtn} onPress={downloadImage}>
              {mob && <RivalIcon name="upload" size={18} color={rm.primaryText.color as string} />}
              <Text style={mob ? rm.primaryText : styles.downloadBtnText}>{em('⬇ Save & Share')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={mob ? rm.ghost : styles.regenerateBtn} onPress={() => generate()}>
              {mob && <RivalIcon name="refresh" size={17} color={RivalColors.accentText} />}
              <Text style={mob ? rm.ghostText : styles.regenerateBtnText}>{em('🔄 Regenerate')}</Text>
            </TouchableOpacity>
            {selectedRaceIds.length > 0 && (
              <TouchableOpacity style={mob ? rm.ghost : styles.regenerateBtn} onPress={stampCountdownOnGenerated}>
                {mob && <RivalIcon name="timer" size={17} color={RivalColors.accentText} />}
                <Text style={mob ? rm.ghostText : styles.regenerateBtnText}>{em('⏳ Stamp event countdown on this image')}</Text>
              </TouchableOpacity>
            )}
            <Text style={styles.shareHint}>Save image to share on social media.</Text>
          </View>
        )}

        {/* Style picker */}
        <Text style={[styles.sectionLabel, mob && ms.sectionLabel]}>Choose a style</Text>
        <View style={styles.styleGrid}>
          {SHARE_STYLES.map(s => (
            <TouchableOpacity
              key={s.id}
              style={[styles.styleCard, mob && ms.styleCard, style.id === s.id && styles.styleCardActive, mob && style.id === s.id && ms.styleCardOn]}
              onPress={() => { setStyle(s); setGeneratedUrl(null); setStampedPreviewUrl(null); }}
              disabled={generating}
            >
              <Text style={[styles.styleLabel, mob && ms.styleLabel]}>{em(s.label)}</Text>
              <Text style={styles.styleDesc}>{s.desc}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Caption */}
        <View style={styles.captionBlock}>
          <TouchableOpacity style={mob ? rm.ghost : styles.captionBtn} onPress={generateCaption} disabled={loadingCaption}>
            {mob && <RivalIcon name="edit" size={16} color={RivalColors.accentText} />}
            <Text style={mob ? rm.ghostText : styles.captionBtnText}>{em(loadingCaption ? '✍️ Writing…' : '✍️ AI caption (optional)')}</Text>
          </TouchableOpacity>
          {caption && (
            <View style={styles.captionPreviewRow}>
              <Text style={[styles.captionPreview, mob && ms.caption]}>"{caption}"</Text>
              <TouchableOpacity onPress={() => setCaption(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                {mob ? <RivalIcon name="close" size={18} color={RivalWarm.muted} /> : <Text style={styles.captionClear}>✕</Text>}
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Transparent stamp — no photo or AI needed, just the stats */}
        {activity && (
          <TouchableOpacity style={[styles.stampBtn, mob && ms.stamp]} onPress={generateStamp}>
            {mob && <View style={rm.iconCircle}><RivalIcon name="stats" size={19} color={RivalColors.accentText} /></View>}
            <View style={mob ? ms.stampText : undefined}>
              <Text style={styles.stampBtnText}>{em('🏷 Download transparent stamp')}</Text>
              <Text style={[styles.stampBtnSub, mob && ms.stampSub]}>Stamp statistics on a photo.</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Race countdown stamp — only when a race is coming up. Chips toggle
            (multi-select): one race = hero countdown, several = stacked rows. */}
        {upcomingRaces.length > 0 && (
          <>
            <View style={styles.liftRow}>
              {upcomingRaces.map(r => (
                <TouchableOpacity
                  key={r.id}
                  style={[styles.liftChip, mob && ms.chip, selectedRaceIds.includes(r.id) && styles.liftChipActive, mob && selectedRaceIds.includes(r.id) && ms.chipOn]}
                  onPress={() => setSelectedRaceIds(prev =>
                    prev.includes(r.id) ? prev.filter(id => id !== r.id) : [...prev, r.id]
                  )}
                >
                  <Text style={styles.liftChipName}>{r.name}</Text>
                  <Text style={styles.liftChipMeta}>{daysUntil(r.race_date)} days</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[styles.stampBtn, mob && ms.stamp, selectedRaceIds.length === 0 && styles.generateBtnDisabled]}
              onPress={generateCountdownStamp}
              disabled={selectedRaceIds.length === 0}
            >
              {mob && <View style={rm.iconCircle}><RivalIcon name="timer" size={19} color={RivalColors.accentText} /></View>}
              <View style={mob ? ms.stampText : undefined}>
              <Text style={styles.stampBtnText}>{em('⏳ Download event countdown stamp')}</Text>
              <Text style={[styles.stampBtnSub, mob && ms.stampSub]}>
                {(() => {
                  const sel = upcomingRaces.filter(x => selectedRaceIds.includes(x.id));
                  if (sel.length === 0) return 'Tap an event above to include it';
                  if (sel.length > 1) return `${sel.length} event countdowns on one stamp — drop it on any photo`;
                  const d = daysUntil(sel[0].race_date);
                  return d === 0 ? `${sel[0].name} is today, stamp it!` : `${d} day${d === 1 ? '' : 's'} until ${sel[0].name} — drop it on any photo`;
                })()}
              </Text>
              </View>
            </TouchableOpacity>
          </>
        )}

        {/* Generate */}
        {quotaRemaining !== null && (
          <Text style={[styles.quotaText, quotaRemaining === 0 && styles.quotaTextEmpty]}>
            {quotaRemaining === 0
              ? `Daily limit reached${quotaResetAt ? ` — resets ${quotaResetAt}` : ''}`
              : `${quotaRemaining} of 2 AI generations left today`}
          </Text>
        )}

        <TouchableOpacity
          style={[mob ? [rm.primary, ms.generate] : styles.generateBtn, ((!photoBase64 && !selectedPhotoUrl) || generating || quotaRemaining === 0) && styles.generateBtnDisabled]}
          onPress={generate}
          disabled={(!photoBase64 && !selectedPhotoUrl) || generating || quotaRemaining === 0}
        >
          {generating ? (
            <View style={styles.generatingRow}>
              <ActivityIndicator color={mob ? rm.primaryText.color as string : '#000'} size="small" />
              <Text style={mob ? rm.primaryText : styles.generateBtnText}>{generatedUrl ? 'Enhancing quality…' : 'Creating share card, this may take a minute.'}</Text>
            </View>
          ) : (
            <View style={styles.generatingRow}>
              {mob && <RivalIcon name="ai" size={18} color={rm.primaryText.color as string} />}
              <Text style={mob ? rm.primaryText : styles.generateBtnText}>
                {em(quotaRemaining === 0 ? '✨ No generations left' : `✨ Generate${quotaRemaining !== null && quotaRemaining <= 2 ? ` (${quotaRemaining} left)` : ''}`)}
              </Text>
            </View>
          )}
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 60 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  back: { color: RivalColors.accentFill, fontSize: 16 },
  title: { fontSize: 20, fontWeight: '800', color: RivalColors.textPrimary },

  activitySummary: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#2A2A2A', gap: 4 },
  activityName: { fontSize: 17, fontWeight: '800', color: RivalColors.textPrimary },
  activityMeta: { fontSize: 13, color: RivalColors.textSecondary },
  routeTag: { fontSize: 11, color: RivalColors.accentText, fontWeight: '600', marginTop: 2 },
  noRouteTag: { fontSize: 11, color: RivalColors.textSecondary, marginTop: 2 },

  photoPicker: { width: '100%', maxWidth: 440, alignSelf: 'center', backgroundColor: RivalColors.surfaceContainer, borderRadius: 16, padding: 28, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(217,119,87,0.27)', alignItems: 'center', gap: 8 },
  photoPickerFilled: { padding: 0, overflow: 'hidden', borderColor: RivalColors.accentFill },
  photoPickerIcon: { fontSize: 36 },
  photoPickerText: { fontSize: 16, fontWeight: '700', color: RivalColors.accentFill },
  photoPickerSub: { fontSize: 12, color: RivalColors.textSecondary, textAlign: 'center' },
  photoThumb: { width: '100%', aspectRatio: 4 / 3, borderRadius: 16, backgroundColor: '#0E0E0E' },
  activityPhotoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  activityPhotoThumb: { width: 72, height: 72, borderRadius: 10, borderWidth: 2, borderColor: '#2A2A2A', overflow: 'hidden' },
  activityPhotoThumbActive: { borderColor: RivalColors.accentFill },
  activityPhotoThumbImg: { width: '100%', height: '100%' },
  changePhotoBtn: { alignSelf: 'center', marginBottom: 20 },
  changePhotoBtnText: { color: RivalColors.textSecondary, fontSize: 13 },

  sectionLabel: { fontSize: 12, fontWeight: '700', color: RivalColors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  styleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  styleCard: { width: '47%', backgroundColor: RivalColors.surfaceContainer, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#2A2A2A', gap: 4 },
  styleCardActive: { backgroundColor: 'rgba(217,119,87,0.10)', borderColor: RivalColors.accentFill },
  styleLabel: { fontSize: 14, fontWeight: '700', color: RivalColors.textPrimary },
  styleDesc: { fontSize: 11, color: RivalColors.textSecondary, lineHeight: 15 },

  liftRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  liftChip: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: '#2A2A2A', gap: 2 },
  liftChipActive: { backgroundColor: 'rgba(217,119,87,0.10)', borderColor: RivalColors.accentFill },
  liftChipName: { color: RivalColors.textPrimary, fontWeight: '700', fontSize: 13 },
  liftChipMeta: { color: RivalColors.textSecondary, fontSize: 11 },
  liftChipTextActive: { color: RivalColors.textPrimary },

  captionBlock: { gap: 10, marginBottom: 20 },
  captionBtn: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#2A2A2A' },
  captionBtnText: { color: RivalColors.accentText, fontWeight: '700', fontSize: 14 },
  captionPreviewRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  captionPreview: { flex: 1, fontSize: 13, color: '#CCCCCC', fontStyle: 'italic' },
  captionClear: { color: RivalColors.textSecondary, fontSize: 16, fontWeight: '700' },

  errorText: { color: '#f87171', fontSize: 13, textAlign: 'center', marginBottom: 12 },
  frameErrorOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  frameErrorText: { color: '#f87171', fontSize: 15, fontWeight: '600', textAlign: 'center', lineHeight: 21 },
  quotaText: { fontSize: 12, color: RivalColors.textSecondary, textAlign: 'center', marginBottom: 8 },
  quotaTextEmpty: { color: '#f87171' },

  stampBtn: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 12, borderWidth: 1, borderColor: '#2A2A2A', alignItems: 'center', gap: 4 },
  stampBtnText: { color: RivalColors.textPrimary, fontWeight: '700', fontSize: 14 },
  stampBtnSub: { color: RivalColors.textSecondary, fontSize: 11, textAlign: 'center' },
  generateBtn: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderRadius: 14, paddingVertical: 18, alignItems: 'center', marginBottom: 28 },
  generateBtnDisabled: { opacity: 0.4 },
  generatingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  generateBtnText: { color: RivalButtonColors.label(RivalColors.textPrimary), fontWeight: '900', fontSize: 17 },

  previewFrame: { width: '100%', position: 'relative' },
  photoThumbResult: { aspectRatio: 2 / 3 },
  loadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10, 6, 10, 0.80)', alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 24 },
  loadingSparkle: { fontSize: 40 },
  loadingMsg: { color: RivalColors.textPrimary, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  loadingTrack: { width: '70%', height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' },
  loadingBar: { width: 90, height: 4, borderRadius: 2, backgroundColor: RivalColors.accentFill },
  loadingSub: { color: '#888888', fontSize: 12 },
  enhancePill: { position: 'absolute', bottom: 14, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  enhancePillText: { color: RivalColors.textPrimary, fontSize: 13, fontWeight: '700' },

  resultActions: { gap: 12, width: '100%', maxWidth: 440, alignSelf: 'center', marginBottom: 24 },
  regenerateBtn: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#2A2A2A' },
  regenerateBtnText: { color: '#CCCCCC', fontWeight: '700', fontSize: 14 },
  downloadBtn: { backgroundColor: RivalColors.accentText, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  downloadBtnText: { color: '#000000', fontWeight: '900', fontSize: 16 },
  shareHint: { fontSize: 12, color: RivalColors.textSecondary, textAlign: 'center' },
});

// Phone only — the blend (grey page, recessed cards).
const ms = StyleSheet.create({
  container: { backgroundColor: RivalColors.surfaceContainer },
  content: { paddingHorizontal: 16, paddingTop: 0, width: '100%', maxWidth: SIDE_PAGE_MAX_WIDTH, alignSelf: 'center' },
  card: { backgroundColor: PHONE_CARD_BG, borderColor: RivalGhost.border, borderRadius: 16, gap: 6 },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: RivalColors.textSecondary },
  chip: { backgroundColor: RivalGhost.fill, borderColor: RivalGhost.border, borderRadius: 14 },
  chipOn: { backgroundColor: 'rgba(217,119,87,0.10)', borderColor: 'rgba(255,181,158,0.6)' },
  thumb: { borderRadius: 12, borderColor: RivalColors.surfaceBright },
  picker: { backgroundColor: RivalGhost.fill, borderColor: 'rgba(255,181,158,0.35)', borderStyle: 'dashed', borderWidth: 1.5, gap: 10 },
  pickerText: { color: RivalColors.accentText },
  styleCard: { backgroundColor: RivalGhost.fill, borderColor: RivalGhost.border, borderRadius: 14 },
  styleCardOn: { backgroundColor: 'rgba(217,119,87,0.10)', borderColor: 'rgba(255,181,158,0.6)' },
  styleLabel: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 16 },
  caption: { fontFamily: RivalSerifFamily, fontSize: 15, lineHeight: 21, color: 'rgba(255,255,255,0.8)' },
  stamp: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: RivalGhost.fill, borderColor: RivalGhost.border, borderRadius: 16, paddingVertical: 14 },
  stampText: { flex: 1, gap: 2 },
  stampSub: { textAlign: 'left', fontSize: 12 },
  generate: { paddingVertical: 16, marginBottom: 28 },
});
