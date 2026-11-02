import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RivalIcon } from './RivalIcon';
import type { MediaItem } from './MediaPicker';

// The camera inside RIVAL, for Capture mid-activity (Ricky, 2026-11-02): one
// tap of the shutter keeps the photo and goes straight back. The phone's own
// camera always asks Use Photo or Retake afterwards, which nobody wants to
// deal with mid-run. Web only for now (the browser's camera needs https, so
// it is unavailable on the local dev address); elsewhere Capture falls back
// to the phone's camera.

export function liveCameraAvailable(): boolean {
  return Platform.OS === 'web' && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
    && typeof window !== 'undefined' && window.isSecureContext;
}

export function LiveCamera({ onShot, onClose, onFail }: {
  onShot: (item: MediaItem) => void;
  onClose: () => void;
  /** The camera could not start (permission refused, no camera). */
  onFail: () => void;
}) {
  const insets = useSafeAreaInsets();
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [ready, setReady] = useState(false);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let live = true;
    setReady(false);
    navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then((s) => {
        if (!live) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current?.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          video.current.play().then(() => live && setReady(true)).catch(() => live && setReady(true));
        }
      })
      .catch(() => { if (live) onFail(); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing]);

  // Off when it closes, so the camera light goes out.
  useEffect(() => () => { stream.current?.getTracks().forEach((t) => t.stop()); }, []);

  function shoot() {
    const v = video.current;
    if (!v || !ready || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    setFlash(true);
    canvas.toBlob((blob) => {
      if (!blob) { setFlash(false); return; }
      onShot({ blob, uri: URL.createObjectURL(blob), type: 'photo', mimeType: 'image/jpeg', ext: 'jpg' });
    }, 'image/jpeg', 0.9);
  }

  const view = (
    <View style={s.cover}>
      <video
        ref={video} playsInline muted autoPlay
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: facing === 'user' ? 'scaleX(-1)' : undefined } as any}
      />
      {flash ? <View style={s.flash} /> : null}
      {ready ? null : <Text style={s.waiting}>Opening the camera</Text>}
      <TouchableOpacity style={[s.round, { top: Math.max(54, insets.top + 4), left: 16 }]} onPress={onClose} accessibilityLabel="Close the camera">
        <RivalIcon name="chevronDown" size={24} color="#fff" />
      </TouchableOpacity>
      <View style={[s.bar, { paddingBottom: Math.max(34, insets.bottom + 14) }]}>
        <View style={s.side} />
        <TouchableOpacity style={s.shutter} onPress={shoot} accessibilityLabel="Take photo" activeOpacity={0.8}>
          <View style={s.shutterIn} />
        </TouchableOpacity>
        <View style={s.side}>
          <TouchableOpacity style={s.flip} onPress={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))} accessibilityLabel="Switch camera">
            <RivalIcon name="flipCamera" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
  return createPortal(view, document.body);
}

const s = StyleSheet.create({
  cover: { position: 'fixed' as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000, backgroundColor: '#000' },
  flash: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#fff', opacity: 0.85 },
  waiting: { position: 'absolute', top: '48%' as any, left: 0, right: 0, textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.6)' },
  round: { position: 'absolute', width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(14,13,12,0.55)', alignItems: 'center', justifyContent: 'center' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingTop: 18, backgroundColor: 'rgba(0,0,0,0.35)' },
  side: { flex: 1, alignItems: 'center' },
  shutter: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterIn: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#fff' },
  flip: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
});
