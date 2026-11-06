// A leg of an event as the page names it: "Swim", "Bike", "Run", with its
// distance. Shared by the event page and its Edit times pop-up.

import { tileLabel } from './activityTypes';
import { distanceUnit, toDisplayDistance } from './units';

type LegLike = { activity_type: string; distance_meters: number | null };
type RaceLike = { disciplines?: { name?: string }[] | null } | null;

/** A leg's distance as a number and unit: swims in metres up to a kilometre. */
export function legDistance(a: LegLike): { num: string; unit: string } | null {
  const m = a.distance_meters ?? 0;
  if (m < 1) return null;
  if (a.activity_type === 'Swim' && m < 1000) return { num: String(Math.round(m)), unit: 'm' };
  const swim = a.activity_type === 'Swim';
  const v = swim ? m / 1000 : toDisplayDistance(m / 1000);
  const num = v >= 10 && Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1);
  return { num, unit: swim ? 'km' : distanceUnit() };
}

export function legName(race: RaceLike, a: LegLike, i: number): string {
  const named = race?.disciplines?.[i]?.name;
  if (named) return named;
  if (a.activity_type === 'Ride' || a.activity_type === 'VirtualRide') return 'Bike';
  return tileLabel(a.activity_type);
}
