// No "…" where text is cut off (Ricky, 2026-10-19). On a loading or saving
// label "…" is fine, and the label pulses (2026-10-21, pulse() below).
// Text held to one line or a few lines (numberOfLines) would otherwise be cut off with an ellipsis when
// it doesn't fit. On web, one watcher looks after all of it: a line that
// overflows is set a little smaller until it fits; if it would need to shrink
// by more than about a fifth, it is allowed onto another line instead.
//
// It works on the rendered page, so it covers every screen without each
// numberOfLines being changed. Native would need its own approach.

const MIN_SCALE = 0.8;
const ORIGINAL = 'data-fit-size';

// The text's own width. Safari doesn't count text cut off by an ellipsis in
// scrollWidth, so an overflowing line looked as if it fitted there.
function textWidth(el: HTMLElement): number {
  const r = document.createRange();
  r.selectNodeContents(el);
  return Math.max(el.scrollWidth, Math.ceil(r.getBoundingClientRect().width));
}

function fit(el: HTMLElement) {
  const cs = getComputedStyle(el);
  const oneLine = cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap';
  // Only a real line count: Safari reports values other than 'none' for
  // text that isn't clamped, and treating those as clamped let any text
  // held to a fixed height (the chat preview) spill out of its card.
  const clamped = parseInt((cs as any).webkitLineClamp, 10) > 0;
  if (!oneLine && !clamped) return;

  if (clamped) {
    if (el.scrollHeight <= el.clientHeight + 1) return;
    // Several lines already and still too long: let it run on.
    el.style.setProperty('-webkit-line-clamp', 'unset');
    el.style.display = 'block';
    el.style.overflow = 'visible';
    return;
  }

  if (textWidth(el) <= el.clientWidth + 1 || el.clientWidth === 0) return;
  const base = parseFloat(el.getAttribute(ORIGINAL) || cs.fontSize);
  if (!el.hasAttribute(ORIGINAL)) el.setAttribute(ORIGINAL, String(base));
  const current = parseFloat(cs.fontSize);
  const next = Math.floor(current * (el.clientWidth / textWidth(el)) * 0.99 * 10) / 10;
  if (next >= base * MIN_SCALE) {
    el.style.fontSize = `${next}px`;
    // Units in their own smaller type don't scale with it; check again.
    if (textWidth(el) <= el.clientWidth + 1) return;
  }
  // Too long to shrink nicely: a second line, at the smallest allowed size.
  el.style.fontSize = `${Math.round(base * MIN_SCALE * 10) / 10}px`;
  el.style.whiteSpace = 'normal';
  // A long word with no spaces would otherwise run out of its box.
  el.style.overflowWrap = 'anywhere';
  el.style.textOverflow = 'clip';
  el.style.overflow = 'visible';
}

// A label still working ("Saving…", "Loading…") breathes while it shows
// (Ricky, 2026-10-21). "…" is fine there; it's only banned as a cut-off.
// Phones only, like the rest of the mobile pass.
const BUSY = 'data-busy-pulse';
function pulse(el: HTMLElement) {
  const busy = window.innerWidth < 640 && /…\s*$/.test(el.textContent || '') && !el.querySelector('[dir="auto"]');
  if (busy === el.hasAttribute(BUSY)) return;
  if (busy) {
    el.setAttribute(BUSY, '');
    el.style.animation = 'rivalBusyPulse 1.4s ease-in-out infinite';
  } else {
    el.removeAttribute(BUSY);
    el.style.animation = '';
  }
}

// Only the text that changed is looked at, not every line in the app: the
// four tabs stay mounted, so a whole-page pass measured thousands of lines
// each time a number counted up, and made the app lag (Ricky, 2026-10-21).
// Text that is hidden when it changes (another tab, a closed sheet) is kept
// aside and measured after the next tap, which is what opens a tab or sheet.
// (An IntersectionObserver on each one was tried: thousands of hidden lines
// being watched made scrolling lag.)
const waiting = new Set<HTMLElement>();
function check(el: HTMLElement) {
  // Counting figures change every frame and are sized by a hidden copy.
  if (el.hasAttribute('data-nofit')) return;
  pulse(el);
  if (el.clientWidth === 0) {
    waiting.add(el);
    return;
  }
  waiting.delete(el);
  // Cheap check first: only text that overflows its box at all.
  if (textWidth(el) > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) fit(el);
}

// Large passes (the first one, a whole tab arriving) run in batches when the
// phone is idle, so loading a screen never waits on the measuring.
function inBatches(list: HTMLElement[]) {
  if (list.length <= 150) { list.forEach(check); return; }
  const idle = (window as any).requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 16));
  const batch = () => {
    list.splice(0, 150).forEach(check);
    if (list.length) idle(batch);
  };
  idle(batch);
}

function pass(roots: Set<Node> | null) {
  if (!roots) {
    inBatches([...document.querySelectorAll<HTMLElement>('[dir="auto"]')]);
    return;
  }
  const seen = new Set<HTMLElement>();
  roots.forEach((n) => {
    if (!n.isConnected) return;
    const el = (n.nodeType === Node.ELEMENT_NODE ? n : n.parentElement) as HTMLElement | null;
    if (!el) return;
    // The changed text itself, and any text inside what was added.
    const own = el.closest<HTMLElement>('[dir="auto"]');
    if (own) seen.add(own);
    el.querySelectorAll<HTMLElement>('[dir="auto"]').forEach((t) => seen.add(t));
  });
  inBatches([...seen]);
}

export function startTextFit() {
  if (typeof document === 'undefined') return () => {};
  let queued = 0;
  // null: look at everything (first run, resize, fonts loaded).
  let roots: Set<Node> | null = null;
  let full = true;
  const run = () => { queued = 0; const r = full ? null : roots; full = false; roots = null; pass(r); };
  const schedule = () => { if (!queued) queued = window.setTimeout(run, 120); };
  const scheduleAll = () => { full = true; schedule(); };
  const mo = new MutationObserver((records) => {
    if (!full) {
      roots = roots ?? new Set();
      for (const r of records) {
        if (r.type === 'characterData') roots.add(r.target);
        else r.addedNodes.forEach((n) => roots!.add(n));
      }
    }
    schedule();
  });
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener('resize', scheduleAll);
  let afterTap = 0;
  const onTap = () => {
    window.clearTimeout(afterTap);
    // After the tap's own work (opening the tab) is done, and in small
    // batches when the phone is idle, so a newly opened tab never waits on it.
    afterTap = window.setTimeout(() => {
      const ready = [...waiting].filter((el) => { if (!el.isConnected) { waiting.delete(el); return false; } return el.clientWidth > 0; });
      const idle = (window as any).requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 16));
      const batch = () => {
        ready.splice(0, 100).forEach(check);
        if (ready.length) idle(batch);
      };
      idle(batch);
    }, 600);
  };
  window.addEventListener('pointerup', onTap, { passive: true });
  document.fonts?.ready.then(scheduleAll).catch(() => {});
  schedule();
  return () => {
    mo.disconnect(); waiting.clear();
    window.removeEventListener('resize', scheduleAll); window.removeEventListener('pointerup', onTap);
    window.clearTimeout(queued); window.clearTimeout(afterTap);
  };
}
