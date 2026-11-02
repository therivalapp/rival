import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Animated, Platform, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { RivalColors } from '../../constants/rivalTheme';
import { RivalIcon } from './RivalIcon';

// "Run saved." at the bottom of the page you return to, after saving from
// the Finish pop-up (Ricky, 2026-11-02). Edit opens the activity to change
// the name, add a description or more photos. Mounted once, in the root layout.

type Note = { text: string; activityId: string; key: number };
let pending: Note | null = null;
const listeners = new Set<(n: Note) => void>();

export function showSavedActivityNote(text: string, activityId: string) {
  pending = { text, activityId, key: Date.now() };
  listeners.forEach((fn) => fn(pending!));
}

export function SavedActivityNote() {
  const [note, setNote] = useState<Note | null>(null);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const fn = (n: Note) => setNote(n);
    listeners.add(fn);
    if (pending) setNote(pending);
    return () => { listeners.delete(fn); };
  }, []);

  useEffect(() => {
    if (!note) return;
    fade.setValue(0);
    const run = Animated.sequence([
      Animated.delay(450),
      Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: false }),
      Animated.delay(4200),
      Animated.timing(fade, { toValue: 0, duration: 300, useNativeDriver: false }),
    ]);
    run.start(({ finished }) => { if (finished) { pending = null; setNote(null); } });
    return () => run.stop();
  }, [note, fade]);

  if (!note) return null;
  const edit = () => {
    pending = null;
    setNote(null);
    router.push({ pathname: '/manual-entry', params: { editId: note.activityId } });
  };
  const view = (
    <Animated.View style={[s.toast, { opacity: fade }]}>
      <RivalIcon name="checkCircle" size={20} color={RivalColors.accentText} />
      <Text style={s.text}>{note.text}</Text>
      <TouchableOpacity onPress={edit} style={s.edit} accessibilityRole="button" accessibilityLabel="Edit the activity">
        <Text style={s.editText}>Edit</Text>
      </TouchableOpacity>
    </Animated.View>
  );
  return Platform.OS === 'web' ? createPortal(view, document.body) : view;
}

const s = StyleSheet.create({
  toast: {
    position: Platform.OS === 'web' ? ('fixed' as any) : 'absolute', left: 16, right: 16, bottom: 92, zIndex: 401,
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#282828', borderWidth: 1, borderColor: 'rgba(255,181,158,0.25)', borderRadius: 16, paddingVertical: 8, paddingLeft: 14, paddingRight: 6,
  },
  text: { flex: 1, color: '#fff', fontSize: 13 },
  edit: { paddingVertical: 6, paddingHorizontal: 12 },
  editText: { color: RivalColors.accentText, fontSize: 13, fontWeight: '800' },
});
