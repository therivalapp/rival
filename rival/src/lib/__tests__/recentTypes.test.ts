import { describe, expect, it, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {}, getAuthUser: vi.fn() }));
vi.mock('../snapState', () => ({ useSnapState: vi.fn() }));
vi.mock('../prefs', () => ({ getPrefs: () => ({ usualTypes: [] }) }));
import { tilesFor, withUsual } from '../recentTypes';

const DEFAULTS = ['WeightTraining', 'Run', 'Ride', 'Swim'];

describe('withUsual', () => {
  it('puts a new member\'s picks first', () => {
    expect(tilesFor(withUsual([], ['Tennis', 'Yoga']), DEFAULTS)).toEqual(['Tennis', 'Yoga', 'WeightTraining', 'Run']);
  });
  it('lets logged history lead, with picks after', () => {
    expect(withUsual(['Run', 'Run'], ['Tennis', 'Run'])).toEqual(['Run', 'Run', 'Tennis']);
  });
});
