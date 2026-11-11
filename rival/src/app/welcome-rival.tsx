import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { RivalColors, RivalSerifFamily, rivalWordmark } from '../constants/rivalTheme';
import { GreyPrimary } from '../components/rival/RivalGreySheet';

// The first setup step (Mockup 35 A, approved 2026-11-11): what the name
// means, before Choose activities. Photo made with fal.ai
// (assets/images/backgrounds/fal-originals/README.md). Text in the Mockup 32
// v2 serif quote style. Shown once, as part of setup after sign-up.

const PHOTO = require('../../assets/images/backgrounds/optimized/runners-coastal-road-dusk.jpg');

export default function WelcomeRivalScreen() {
  return (
    <View style={s.page}>
      <Image source={PHOTO} style={s.photo} resizeMode="cover" />
      {/* Darkens the top a little for the wordmark and the lower half for the words. */}
      {Platform.OS === 'web' ? (
        <View style={[s.fill, s.scrimWeb]} />
      ) : (
        <Svg style={s.fill} width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
          <Defs>
            <LinearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#131313" stopOpacity={0.35} />
              <Stop offset="0.22" stopColor="#131313" stopOpacity={0} />
              <Stop offset="0.45" stopColor="#131313" stopOpacity={0} />
              <Stop offset="0.72" stopColor="#131313" stopOpacity={0.88} />
              <Stop offset="1" stopColor="#131313" stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100" height="100" fill="url(#scrim)" />
        </Svg>
      )}

      <SafeAreaView style={s.safe} edges={['top', 'bottom', 'left', 'right']}>
        <View style={s.top}>
          <Text style={s.word}>RIVAL</Text>
          <View style={s.steps}><View style={[s.step, s.stepOn]} /><View style={s.step} /><View style={s.step} /></View>
        </View>

        <View style={s.bottom}>
          <View style={s.rule} />
          <Text style={s.title}>A Rival brings out your best</Text>
          <Text style={s.quote}>
            A Rival isn&rsquo;t someone you&rsquo;re against. It&rsquo;s someone who inspires you to be better, and who you inspire in return.
          </Text>
          <View style={s.button}>
            <GreyPrimary label="Continue" onPress={() => router.replace('/choose-activities')} />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#131313' },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  photo: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  scrimWeb: { backgroundImage: 'linear-gradient(180deg, rgba(19,19,19,0.35) 0%, rgba(19,19,19,0) 22%, rgba(19,19,19,0) 45%, rgba(19,19,19,0.88) 72%, #131313 100%)' } as any,
  safe: { flex: 1, justifyContent: 'space-between' },
  top: { alignItems: 'center', paddingTop: 14 },
  word: { ...rivalWordmark(20), color: '#fff' },
  steps: { flexDirection: 'row', gap: 6, marginTop: 16 },
  step: { width: 18, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' },
  stepOn: { backgroundColor: RivalColors.accentText },
  bottom: { paddingHorizontal: 28, paddingBottom: Platform.OS === 'web' ? 28 : 12, alignItems: 'center', maxWidth: 520, width: '100%', alignSelf: 'center' },
  rule: { width: 36, height: 2, backgroundColor: RivalColors.accentText, marginBottom: 16 },
  title: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 30, lineHeight: 36, color: '#fff', textAlign: 'center' },
  quote: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 19, lineHeight: 26, color: 'rgba(255,255,255,0.9)', textAlign: 'center', marginTop: 12 },
  button: { alignSelf: 'stretch', marginTop: 32 },
});
