import { getPrefs, type UnitSystem } from './prefs';

// Distances, climbs and weights in whichever units the person chose in
// Profile. Everything is stored metric; conversion happens only on the way to
// the screen (and back again for typed-in values).

export const KM_PER_MILE = 1.609344;
export const FEET_PER_METRE = 3.28084;
export const LB_PER_KG = 2.20462;

const sys = (s?: UnitSystem) => s ?? getPrefs().units;

export function distanceUnit(s?: UnitSystem): 'km' | 'mi' {
  return sys(s) === 'imperial' ? 'mi' : 'km';
}
export function elevationUnit(s?: UnitSystem): 'm' | 'ft' {
  return sys(s) === 'imperial' ? 'ft' : 'm';
}
export function weightUnit(s?: UnitSystem): 'kg' | 'lb' {
  return sys(s) === 'imperial' ? 'lb' : 'kg';
}

/** Kilometres → the display number (km or miles). */
export function toDisplayDistance(km: number, s?: UnitSystem): number {
  return sys(s) === 'imperial' ? km / KM_PER_MILE : km;
}
/** A typed distance in display units → kilometres. */
export function fromDisplayDistance(value: number, s?: UnitSystem): number {
  return sys(s) === 'imperial' ? value * KM_PER_MILE : value;
}
export function toDisplayElevation(m: number, s?: UnitSystem): number {
  return sys(s) === 'imperial' ? m * FEET_PER_METRE : m;
}
export function fromDisplayElevation(value: number, s?: UnitSystem): number {
  return sys(s) === 'imperial' ? value / FEET_PER_METRE : value;
}
export function toDisplayWeight(kg: number, s?: UnitSystem): number {
  return sys(s) === 'imperial' ? kg * LB_PER_KG : kg;
}

/** "11.0 km" / "6.8 mi". */
export function formatDistance(km: number, decimals = 1, s?: UnitSystem): string {
  return `${toDisplayDistance(km, s).toFixed(decimals)} ${distanceUnit(s)}`;
}
/** Metres in, "1,240 m" / "4,068 ft" out. */
export function formatElevation(m: number, s?: UnitSystem): string {
  return `${Math.round(toDisplayElevation(m, s)).toLocaleString()} ${elevationUnit(s)}`;
}
/** Kilograms in, "100 kg" / "220.5 lb" out; whole numbers stay whole. */
export function formatWeight(kg: number, s?: UnitSystem): string {
  const v = toDisplayWeight(kg, s);
  const shown = Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1);
  return `${shown} ${weightUnit(s)}`;
}

// Swims and rows are measured in metres whichever system is chosen — pools and
// ergs are metric almost everywhere, and a 1500 m swim reads wrong in miles.
const METRE_SPORTS = new Set(['Swim', 'Rowing']);

/** An activity's distance the way the activity lists show it: metres for
 *  swims and rows, otherwise km or miles to one decimal. Null when there is
 *  nothing worth showing. */
export function formatActivityDistance(meters: number | null | undefined, activityType?: string | null, minMeters = 1, s?: UnitSystem): string | null {
  if (!meters || meters < minMeters) return null;
  if (activityType && METRE_SPORTS.has(activityType)) return `${Math.round(meters)} m`;
  return formatDistance(meters / 1000, 1, s);
}

/** Speed for rides ("28.4 km/h" / "17.6 mph"), otherwise time per km or mile. */
export function formatSpeedOrPace(meters: number, seconds: number, activityType: string, s?: UnitSystem): string {
  const imperial = sys(s) === 'imperial';
  if (activityType === 'Ride' || activityType === 'VirtualRide') {
    const kmh = (meters / 1000) / (seconds / 3600);
    return imperial ? `${(kmh / KM_PER_MILE).toFixed(1)} mph` : `${kmh.toFixed(1)} km/h`;
  }
  if (activityType === 'Swim') {
    const per = seconds / (meters / 100);
    return `${Math.floor(per / 60)}:${String(Math.round(per % 60)).padStart(2, '0')} /100m`;
  }
  const perUnit = seconds / (toDisplayDistance(meters / 1000, s));
  let m = Math.floor(perUnit / 60);
  let sec = Math.round(perUnit % 60);
  if (sec === 60) { m += 1; sec = 0; }
  return `${m}:${String(sec).padStart(2, '0')} /${distanceUnit(s)}`;
}

/** Whole numbers for totals: "1,240 km" / "771 mi". */
export function formatDistanceWhole(km: number, s?: UnitSystem): string {
  return `${Math.round(toDisplayDistance(km, s)).toLocaleString()} ${distanceUnit(s)}`;
}
/** A total as a bare number in the chosen units, for layouts that set the unit apart. */
export function distanceNumber(km: number, s?: UnitSystem): string {
  return Math.round(toDisplayDistance(km, s)).toLocaleString();
}
export function elevationNumber(m: number, s?: UnitSystem): string {
  return Math.round(toDisplayElevation(m, s)).toLocaleString();
}
