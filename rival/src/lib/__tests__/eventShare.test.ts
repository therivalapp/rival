import { describe, expect, it } from 'vitest';
import { defaultEventStats, eventRowFigures, eventStatOptions, placeHero } from '../eventShare';

const placings = [
  { key: 'division', category: 'Open Men', place: 86, of: 1240 },
  { key: 'overall', category: null, place: 214, of: 3100 },
  { key: 'age', category: 'M 35-39', place: 19, of: 262 },
];

describe('event share choices', () => {
  it('leads a marathon with the finish, then its placings', () => {
    const o = eventStatOptions({ kind: 'race', finishSeconds: 12025, placings: placings.slice(1), pace: { value: '4:45', unit: '/km' } });
    expect(o.map((x) => x.key)).toEqual(['finish', 'pl0', 'pl1', 'pace']);
    expect(o[1].figure).toEqual({ value: '214', sup: 'th', label: 'Overall' });
    expect(defaultEventStats(o)).toEqual(['finish', 'pl0', 'pl1']);
  });

  it('starts a marathon on its finish, Overall and Age group, whatever order they were entered in', () => {
    const facts = { kind: 'race' as const, finishSeconds: 12025, placings };
    const o = eventStatOptions(facts);
    // placings: division (pl0), overall (pl1), age (pl2).
    expect(defaultEventStats(o, facts)).toEqual(['finish', 'pl1', 'pl2']);
    const noAge = { ...facts, placings: placings.slice(0, 2) };
    expect(defaultEventStats(eventStatOptions(noAge), noAge)).toEqual(['finish', 'pl1', 'pl0']);
  });

  it('leads HYROX with the division place, then the finish and its splits', () => {
    const o = eventStatOptions({ kind: 'hyrox', finishSeconds: 5076, placings, hyrox: { running: 2406, stations: 2093, roxzone: 577 } });
    expect(o.map((x) => x.key)).toEqual(['pl0', 'finish', 'pl1', 'pl2', 'running', 'stations', 'roxzone']);
    expect(o[0].placing).toBe(true);
  });

  it('gives several days their events, time worked, days and best event', () => {
    const o = eventStatOptions({ kind: 'days', finishSeconds: 0, placings, days: { count: 3, events: 5, worked: 5595, bestPlace: 6 } });
    expect(o.map((x) => x.key)).toEqual(['pl0', 'pl1', 'pl2', 'events', 'worked', 'days', 'bestEvent']);
  });

  it('keeps the hero out of the row and puts Effort last in gold', () => {
    const o = eventStatOptions({ kind: 'hyrox', finishSeconds: 5076, placings });
    const hero = placeHero(o, ['pl0', 'finish', 'pl1']);
    expect(hero?.key).toBe('pl0');
    expect(eventRowFigures(o, ['pl0', 'finish', 'pl1'], 'pl0', 180).map((f) => f.label)).toEqual(['Finish', 'Overall', 'Effort']);
    expect(eventRowFigures(o, ['pl0'], 'pl0', 180).at(-1)).toEqual({ value: '180', label: 'Effort', gold: true });
  });
});
