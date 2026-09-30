import { useCallback, useState } from 'react';
import { supabase } from './supabase';

// State that outlives the screen it belongs to. Expo Router unmounts a screen
// when you move to another tab, so every return used to start from empty and
// show the loading skeleton while the same data downloaded again. A screen
// that keeps its data here draws its last state at once and refreshes behind
// it. Cleared whenever the signed-in account changes, so nobody ever sees the
// previous person's figures.

const store = new Map<string, unknown>();
let owner: string | null = null;

supabase.auth.onAuthStateChange((_event, session) => {
  const id = session?.user?.id ?? null;
  if (id !== owner) { store.clear(); owner = id; }
});

type SetState<T> = (next: T | ((prev: T) => T)) => void;

export function useSnapState<T>(key: string, initial: T): [T, SetState<T>] {
  const [value, setValue] = useState<T>(() => (store.has(key) ? (store.get(key) as T) : initial));
  const set = useCallback<SetState<T>>((next) => {
    setValue((prev) => {
      const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      store.set(key, v);
      return v;
    });
  }, [key]);
  return [value, set];
}
