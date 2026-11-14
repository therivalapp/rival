// A few lines of progress shown on the simulator build only (SimUpdateTag),
// for checking iPhone-only code on Appetize, where the console can't be read.
type L = (lines: string[]) => void;
let lines: string[] = [];
const listeners = new Set<L>();
export function simLog(msg: string) {
  lines = [...lines.slice(-5), `${new Date().toISOString().slice(14, 19)} ${msg}`];
  listeners.forEach((l) => l(lines));
}
export function subscribeSimLog(fn: L): () => void {
  listeners.add(fn);
  fn(lines);
  return () => { listeners.delete(fn); };
}
