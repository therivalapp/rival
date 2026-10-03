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

/** Opens the camera or photo library straight from a tap (web only). */
export function pickScanFiles(source: 'camera' | 'gallery', onPicked: (files: File[]) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  if (source === 'camera') input.setAttribute('capture', 'environment');
  else input.multiple = true;
  input.onchange = () => {
    const files = Array.from(input.files || []);
    if (files.length > 0) onPicked(files);
  };
  input.click();
}
