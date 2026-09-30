// Dates are typed and shown day first, DD/MM/YYYY (Ricky's call, 2026-09-28:
// day, month, year, the way RIVAL's first users read dates). The database
// still stores YYYY-MM-DD, so these helpers convert at the edge of the UI.

// Auto-inserts the "/" separators as digits are typed, so a forgotten
// separator can never produce a string displayToIsoDate rejects in the first
// place. Recomputes from the raw digits on every keystroke rather than
// tracking cursor position, so backspacing anywhere in the string — including
// right on top of an inserted separator — just re-collapses to the same digits
// and reformats cleanly instead of getting stuck. Wire this as the
// onChangeText for every screen's own date TextInput.
export function maskDateInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  const day = digits.slice(0, 2);
  const month = digits.slice(2, 4);
  const year = digits.slice(4, 8);
  return [day, month, year].filter(Boolean).join('/');
}

export function isoToDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

// Returns null if the input isn't a valid DD/MM/YYYY date.
export function displayToIsoDate(display: string): string | null {
  const match = display.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // Reject impossible dates (e.g. 31/02/2026) by round-tripping through Date.
  const check = new Date(year, month - 1, day);
  if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) return null;
  return iso;
}

// "Today", "Tomorrow" or "Tue 29 Sep" for a DD/MM/YYYY value. A plan reads
// as a day, not a form field. Falls back to the raw value if it won't parse.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function friendlyDate(display: string): string {
  const iso = displayToIsoDate(display);
  if (!iso) return display;
  const [y, mo, d] = iso.split('-').map(Number);
  const day = new Date(y, mo - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  const base = `${DAYS[day.getDay()]} ${d} ${MONTHS[mo - 1]}`;
  return y === now.getFullYear() ? base : `${base} ${y}`;
}

// "07:00" -> "7:00 am".
export function friendlyTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return t;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
