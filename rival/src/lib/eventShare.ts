// What an event share can show (Ricky, 2026-11-05, design/event-share-mockup.png):
// the finish, each placing (ivory-edged tiles), HYROX's running, stations and
// Roxzone, and over several days the events, time worked, days and best event
// place, plus the race's own distance, pace and elevation. Effort is always on
// and last, in gold, as on every share. Pure functions; the pop-up is
// components/rival/EventShare.tsx.

import { liveClock } from './liveActivity';
import { ordinalSuffix, placingCaption, type PlacingRow } from './eventPage';
import type { StampFigure, StatKey, StatOption } from './shareStamp';

export type EventShareFacts = {
  kind: 'race' | 'hyrox' | 'days' | 'legs';
  finishSeconds: number;
  placings: PlacingRow[];
  /** HYROX totals, when its splits were recorded. */
  hyrox?: { running: number; stations: number; roxzone: number } | null;
  /** Several days. */
  days?: { count: number; events: number; worked: number; bestPlace: number | null } | null;
  /** A race: distance and pace, already in the member's units. */
  distance?: { value: string; unit: string } | null;
  pace?: { value: string; unit: string } | null;
  elevation?: { value: string; unit: string } | null;
};

const PLACE_KEYS: StatKey[] = ['pl0', 'pl1', 'pl2', 'pl3', 'pl4'];

function placeFigure(n: number, label: string): StampFigure {
  return { value: n.toLocaleString(), sup: ordinalSuffix(n), label };
}

/** Every choice for this event, in the order the tiles show them. */
export function eventStatOptions(f: EventShareFacts): StatOption[] {
  const out: StatOption[] = [];
  const finish: StatOption | null = f.finishSeconds > 0
    ? { key: 'finish', label: 'Finish', figure: { value: liveClock(f.finishSeconds), label: 'Finish' } } : null;
  const places: StatOption[] = f.placings.slice(0, PLACE_KEYS.length).map((r, i) => {
    const label = placingCaption(r);
    return { key: PLACE_KEYS[i], label, figure: placeFigure(r.place ?? 0, label), placing: true };
  });
  // HYROX leads with its division place, then the finish (the mockup's order).
  if (f.kind === 'hyrox' && places.length) out.push(places[0], ...(finish ? [finish] : []), ...places.slice(1));
  else if (f.kind === 'days') out.push(...places);
  else out.push(...(finish ? [finish] : []), ...places);
  if (f.hyrox) {
    out.push({ key: 'running', label: 'Running', figure: { value: liveClock(f.hyrox.running), label: 'Running' } });
    out.push({ key: 'stations', label: 'Stations', figure: { value: liveClock(f.hyrox.stations), label: 'Stations' } });
    if (f.hyrox.roxzone) out.push({ key: 'roxzone', label: 'Roxzone', figure: { value: liveClock(f.hyrox.roxzone), label: 'Roxzone' } });
  }
  if (f.days) {
    out.push({ key: 'events', label: 'Events', figure: { value: String(f.days.events), label: f.days.events === 1 ? 'Event' : 'Events' } });
    out.push({ key: 'worked', label: 'Worked', figure: { value: liveClock(f.days.worked), label: 'Worked' } });
    out.push({ key: 'days', label: 'Days', figure: { value: String(f.days.count), label: 'Days' } });
    if (f.days.bestPlace) out.push({ key: 'bestEvent', label: 'Best event', figure: placeFigure(f.days.bestPlace, 'Best event'), placing: true });
  }
  if (f.kind === 'race') {
    if (f.pace) out.push({ key: 'pace', label: 'Pace', figure: { value: f.pace.value, unit: f.pace.unit, label: 'Pace' } });
    if (f.distance) out.push({ key: 'distance', label: 'Distance', figure: { value: f.distance.value, unit: f.distance.unit, label: 'Distance' } });
    if (f.elevation) out.push({ key: 'climb', label: 'Elevation', figure: { value: f.elevation.value, unit: f.elevation.unit, label: 'Elevation' } });
  }
  if (f.kind === 'legs' && finish && !out.includes(finish)) out.unshift(finish);
  return out;
}

/** The first three choices start chosen: the mockup's picks. */
export function defaultEventStats(options: StatOption[]): StatKey[] {
  return options.slice(0, 3).map((o) => o.key);
}

/** The figures for the row under the hero, without whatever the hero shows. */
export function eventRowFigures(options: StatOption[], keys: StatKey[], hero: StatKey | null, effort: number): StampFigure[] {
  const chosen = options.filter((o) => keys.includes(o.key) && o.key !== hero).map((o) => o.figure);
  return [...chosen, { value: String(Math.round(effort * 10) / 10), label: 'Effort', gold: true }];
}

/** The place stamp's hero: the first placing chosen, else the first placing. */
export function placeHero(options: StatOption[], keys: StatKey[]): StatOption | null {
  return options.find((o) => o.placing && o.key !== 'bestEvent' && keys.includes(o.key))
    ?? options.find((o) => o.placing && o.key !== 'bestEvent') ?? null;
}
