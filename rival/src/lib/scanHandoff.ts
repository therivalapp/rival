// Photos picked on Add an activity, handed to the scan page.
//
// iPhone Safari only opens the camera or photo library from a tap. The scan
// page used to open its picker by itself once it loaded, which Safari
// blocked, so Take photo and Upload landed on the scan page instead of the
// picker. The tiles now open the picker from the tap itself and leave the
// chosen files here for the scan page to read, once, when it opens.

let pending: File[] | null = null;

export function setPendingScanFiles(files: File[]) {
  pending = files;
}

export function takePendingScanFiles(): File[] | null {
  const files = pending;
  pending = null;
  return files;
}

/** Opens the camera or photo library straight from a tap (web only).
 *  With `withVideos`, videos can be picked too: Upload takes the workout's
 *  photos and videos together and sorts them (scan-workout.tsx). */
export function pickScanFiles(source: 'camera' | 'gallery', onPicked: (files: File[]) => void, withVideos = false) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = withVideos && source === 'gallery' ? 'image/*,video/*' : 'image/*';
  if (source === 'camera') input.setAttribute('capture', 'environment');
  else input.multiple = true;
  input.onchange = () => {
    const files = Array.from(input.files || []);
    if (files.length > 0) onPicked(files);
  };
  input.click();
}

// Photos from Upload that were taken on several days, already grouped by day
// (lib/photoDates.ts), handed to Multi-day scan to read one activity a day.
let pendingDays: { date: Date; files: File[] }[] | null = null;

export function setPendingScanDays(days: { date: Date; files: File[] }[]) {
  pendingDays = days;
}

export function takePendingScanDays(): { date: Date; files: File[] }[] | null {
  const days = pendingDays;
  pendingDays = null;
  return days;
}
