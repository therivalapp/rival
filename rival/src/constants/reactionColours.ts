import { Platform } from 'react-native';

// Respect and Inspired once you've given them, on phones (Ricky, 2026-10-05):
// Respect in a brighter version of the buttons' orange-to-salmon fade,
// Inspired in the faded gold of "Effort today".
// The star is one solid colour: the middle of Respect's fade.
export const RESPECT_COLOUR = '#f4a98a';
export const INSPIRED_COLOUR = '#f5b759';

function fadeText(from: string, to: string): object {
  return Platform.OS === 'web'
    ? { color: to, backgroundImage: `linear-gradient(180deg, ${from}, ${to})`, backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }
    : { color: to };
}

export const respectGivenText = Platform.OS === 'web'
  ? { color: RESPECT_COLOUR, backgroundImage: 'linear-gradient(135deg, #e8835f, #ffd0bd)', backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }
  : { color: RESPECT_COLOUR };
export const inspiredGivenText = fadeText('#ffe6b0', '#f5b759');

// An activity card's Effort figure on phones: the same tapered gold as
// "Effort today" on Today (Ricky, 2026-10-05).
export const effortGoldText = fadeText('#ffe6b0', '#f5b759');
