import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { RivalColors, RivalFontFamily } from '../constants/rivalTheme';
import { sidePageWide } from '../constants/breakpoints';
import { GreyLabel, GreyPageHead, GreyRows, GREY_PAGE_BG } from '../components/rival';
import { TERMS_INTRO, TERMS_SECTIONS, TERMS_UPDATED } from '../lib/termsText';

// The terms of use in the app, linked from sign-up (2026-11-09). The same
// layout as the privacy policy page. The text comes from TERMS.md through
// scripts/build-site-privacy.py, so the app and the website never differ.

const CONTACT = 'hello@therivalapp.com';

export default function TermsScreen() {
  const phone = !sidePageWide(useWindowDimensions().width);
  // Signed out (opened from sign-up) there may be no history to go back to.
  const back = () => (router.canGoBack() ? router.back() : router.replace('/sign-up'));
  return (
    <SafeAreaView style={[s.page, !phone && s.pageWide]} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={s.content}>
        <GreyPageHead kicker="RIVAL" title="Terms of use" sub={`Last updated ${TERMS_UPDATED}`} onBack={back} />
        {TERMS_INTRO.map((p, i) => <Text key={i} style={s.intro}>{p}</Text>)}
        {TERMS_SECTIONS.map((sec) => (
          <View key={sec.title} style={s.section}>
            <GreyLabel>{sec.title}</GreyLabel>
            <GreyRows>
              {sec.rows.map((row, i) => (
                <View key={i} style={s.item}><Text style={s.body}>{row}</Text></View>
              ))}
            </GreyRows>
          </View>
        ))}
        <Text style={s.contact}>Contact {CONTACT}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: GREY_PAGE_BG },
  pageWide: { backgroundColor: RivalColors.surfaceContainer },
  content: { maxWidth: 560, width: '100%', alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 120, gap: 12 },
  intro: { fontFamily: RivalFontFamily, fontSize: 13.5, lineHeight: 20, color: 'rgba(255,255,255,0.72)', textAlign: 'center', marginBottom: 4 },
  section: { gap: 0 },
  item: { paddingVertical: 11 },
  body: { fontFamily: RivalFontFamily, fontSize: 13, lineHeight: 19, color: RivalColors.textSecondary },
  contact: { fontFamily: RivalFontFamily, fontSize: 12.5, color: RivalColors.textSecondary, textAlign: 'center', marginTop: 4 },
});
