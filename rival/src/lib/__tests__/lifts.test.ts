import { describe, expect, it } from 'vitest';
import { CALISTHENICS_LIFTS, CANONICAL_LIFTS, isHoldLift, matchCanonicalLift } from '../lifts';

describe('calisthenics exercises', () => {
  it('every offered exercise is a tracked lift that matches itself', () => {
    CALISTHENICS_LIFTS.forEach((l) => {
      expect(CANONICAL_LIFTS).toContain(l);
      expect(matchCanonicalLift(l)).toBe(l);
    });
  });

  it('every tracked lift matches itself', () => {
    CANONICAL_LIFTS.forEach((l) => expect(matchCanonicalLift(l)).toBe(l));
  });

  it('reads the common spellings', () => {
    expect(matchCanonicalLift('muscle ups')).toBe('Muscle-up');
    expect(matchCanonicalLift('HSPU')).toBe('Handstand Push-up');
    expect(matchCanonicalLift('L-sits')).toBe('L-sit');
    expect(matchCanonicalLift('Australian pull-ups')).toBe('Inverted Row');
  });

  it('keeps the existing lifts where they were', () => {
    expect(matchCanonicalLift('chin ups')).toBe('Pull-up');
    expect(matchCanonicalLift('dips')).toBe('Dip');
  });

  it('knows holds from reps, whatever the spelling', () => {
    expect(isHoldLift('planks')).toBe(true);
    expect(isHoldLift('L-sit')).toBe(true);
    expect(isHoldLift('Pull-up')).toBe(false);
    expect(isHoldLift('Bench Press')).toBe(false);
  });
});
