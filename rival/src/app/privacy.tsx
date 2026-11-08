import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { RivalColors, RivalFontFamily } from '../constants/rivalTheme';
import { sidePageWide } from '../constants/breakpoints';
import { GreyLabel, GreyPageHead, GreyRows, GREY_PAGE_BG } from '../components/rival';
import { goToTab } from '../lib/tabNav';

// The privacy policy in the app, so it can be read before agreeing to share
// with teams. Same text as PRIVACY_POLICY.md; change both together.

// Set both when the policy is published (BETA_PLAN.md).
const CONTACT = 'hello@therivalapp.com';
const UPDATED: string | null = '8 November 2026';

type Section = { title: string; paras: (string | { b: string; t: string })[]; bullets?: string[] };

const SECTIONS: Section[] = [
  {
    title: 'What RIVAL collects',
    paras: [
      { b: 'Account.', t: 'Email address, display name, optional username, profile photo, cover photo and personal quote.' },
      { b: 'Activities.', t: 'Each activity you add: type, date and time, duration, distance, elevation, exercises, sets and weights, notes, Effort, personal bests, goals, events and finish times. Activities come from manual entry, workout scanning, archive import and RIVAL’s own GPS recording, and, once available, Apple Health on iPhone and Garmin.' },
      { b: 'Routes.', t: 'When an activity has a GPS route, RIVAL stores a simplified outline of it. Teammates see route maps only if you turn on route sharing.' },
      { b: 'Photos and videos.', t: 'Files you attach to activities, set as a cover, or upload for workout scanning.' },
      { b: 'Team activity.', t: 'Messages, comments, reactions (Respect and Inspired), notes, challenges and planned activities you post in your teams, and who invited you to a team.' },
      { b: 'Device token.', t: 'A push-notification token, if you allow notifications.' },
      { b: 'Usage.', t: 'RIVAL does not use analytics, advertising or tracking tools. The services that host RIVAL keep standard technical logs, such as IP address and request times, for security and to fix faults.' },
      'RIVAL does not collect contacts or advertising identifiers.',
    ],
  },
  {
    title: 'Apple Health',
    paras: ['This applies once RIVAL’s iPhone app is available. On iPhone, you can let RIVAL read your workouts from Apple Health. RIVAL reads workout type, time, duration, distance, elevation, energy and route, and only after you allow it in the Health permission screen. Health data is used only to record your activities, score Effort and show them to your teams. It is never used for advertising or marketing, never sold, never given to data brokers, and never stored in iCloud. RIVAL does not write anything to Apple Health. You can turn access off at any time in the iPhone’s Settings.'],
  },
  {
    title: 'GPS recording',
    paras: ['When you record an activity in RIVAL, the app uses your location only while that activity is recording, to measure distance and draw the route. Your live location is never shared.'],
  },
  {
    title: 'Garmin Connect',
    paras: [
      'This applies once Garmin connection is available. If you connect a Garmin account, RIVAL receives the activities your Garmin device records: activity type, start time, duration, distance, elevation, heart rate, pace and splits, route, and the exercises, sets, repetitions and weights of strength activities. RIVAL does not request sleep, stress, steps or other wellness data.',
      'Garmin data is used only to record your activities, score Effort and show them to the teams you choose. Activities from Garmin are marked with the device that recorded them. RIVAL never sells Garmin data, never uses it for advertising and never shares it with anyone other than the service providers that run RIVAL. Disconnecting Garmin stops new activities arriving, and deleting your account deletes the Garmin data RIVAL holds.',
    ],
  },
  {
    title: 'Imports from other apps',
    paras: [
      'You can import your history from an archive file, from RIVAL or another fitness app. The import reads the activities, routes, photos and videos in the file you choose. Nothing else on your device is read.',
    ],
  },
  {
    title: 'AI features',
    paras: ['Some features send content to Anthropic, an AI provider, to produce a result:'],
    bullets: [
      'Workout scanning sends the photo you choose, such as a whiteboard or gym screen, to read the workout details from it.',
      'Find events sends the event name you search for.',
      'Team crests send the team’s name. The crest image is made by fal.ai, and Anthropic reads its lettering back to check the name is spelled correctly.',
      'These providers process the content only to return the result. RIVAL does not send your activity history to them or use your content to train AI models. If a photo includes other people, make sure they are happy for it to be uploaded.',
    ],
  },
  {
    title: 'Who can see your information',
    paras: [],
    bullets: [
      'Your teammates see your name, photos, activities, Effort, rank, profile, reactions, comments and messages in the teams you join. RIVAL asks for your agreement before your activities are shared with any team.',
      'Public teams show their name, crest and member count in Discover. Joining one needs a member or an admin to confirm.',
      'Images you share go wherever you send them.',
      'Service providers run RIVAL on its behalf: Supabase (database, sign-in and file storage), Vercel (web hosting), Cloudflare (domain and email forwarding), Anthropic and fal.ai (the AI features above), Expo (push notifications) and Resend (account emails).',
      'RIVAL never sells personal information and does not share it with anyone else except where the law requires.',
    ],
  },
  {
    title: 'Keeping and deleting your data',
    paras: [],
    bullets: [
      'Your data is kept while your account is open.',
      'You can delete any activity, photo, goal or event in the app.',
      'Profile, Download my data saves a copy of everything RIVAL holds about you.',
      'Profile, Delete account first saves an archive of your activities, photos and videos, then permanently deletes your account and its data. Teams you created pass to another member, or are deleted if you were the only one.',
      `If anything goes wrong, contact ${CONTACT} and the deletion will be completed within 14 days.`,
    ],
  },
  {
    title: 'Security',
    paras: ['Data is stored with Supabase. It is encrypted in transit, and access rules in the database limit each person to the data they are allowed to see.'],
  },
  {
    title: 'Children',
    paras: ['RIVAL is not for children under 13, or the minimum age in your country, and does not knowingly collect their information.'],
  },
  {
    title: 'Your rights',
    paras: [`Depending on where you live, including under Canada’s PIPEDA, New Zealand’s Privacy Act 2020 and the GDPR, you can ask to access, correct, export or delete your personal information. Contact ${CONTACT}.`],
  },
  {
    title: 'Changes',
    paras: ['If this policy changes in a meaningful way, RIVAL will say so in the app and update the date above.'],
  },
];

export default function PrivacyScreen() {
  const phone = !sidePageWide(useWindowDimensions().width);
  const back = () => (router.canGoBack() ? router.back() : goToTab('/home'));
  return (
    <SafeAreaView style={[s.page, !phone && s.pageWide]} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={s.content}>
        <GreyPageHead kicker="RIVAL" title="Privacy policy" sub={UPDATED ? `Last updated ${UPDATED}` : undefined} onBack={back} />
        <Text style={s.intro}>
          RIVAL is a social fitness app. You log activities, earn Effort, and share them with the teams you join. This policy explains what RIVAL collects, who can see it, and how to remove it. RIVAL collects only what it needs to run, does not sell personal information, and does not show advertising.
        </Text>
        {SECTIONS.map((sec) => (
          <View key={sec.title} style={s.section}>
            <GreyLabel>{sec.title}</GreyLabel>
            <GreyRows>
              {[
                ...sec.paras.map((p, i) => (
                  <Text key={`p${i}`} style={s.body}>
                    {typeof p === 'string' ? p : <><Text style={s.bold}>{p.b} </Text>{p.t}</>}
                  </Text>
                )),
                ...(sec.bullets ?? []).map((b, i) => <Text key={`b${i}`} style={s.body}>{b}</Text>),
              ].map((el, i) => <View key={i} style={s.item}>{el}</View>)}
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
  bold: { fontWeight: '700', color: '#fff' },
  contact: { fontFamily: RivalFontFamily, fontSize: 12.5, color: RivalColors.textSecondary, textAlign: 'center', marginTop: 4 },
});
