import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase, getAuthUser } from '../lib/supabase';
import { readPendingInvite } from '../lib/pendingInvite';
import { loadStravaSharing, startStravaConnect } from '../lib/stravaSharing';
import { RivalColors, RivalSerifFamily } from '../constants/rivalTheme';
import { RivalIcon, RivalMobileHeader, RivalRowLink, RivalWarm, rm, type RivalIconName } from '../components/rival';
import { goToTab } from '../lib/tabNav';

// How RIVAL works — the introduction a new person sees straight after
// creating an account, and can come back to from Profile at any time.
//
// Four short ideas, in the order someone meets them in the app, then the two
// things that make it work: bring training in, and find people to train with.
// Each step that's already done shows as done, so returning here later reads
// as a checklist rather than a lecture.

const IDEAS: { icon: RivalIconName; title: string; body: string }[] = [
  {
    icon: 'bolt',
    title: 'Every activity earns Effort',
    body: 'Effort comes from the time you put in, weighted by the kind of activity, with credit for climbing. A gym workout, a swim and a long run all count.',
  },
  {
    icon: 'groups',
    title: 'Teams train together',
    body: 'Each week your team’s Effort builds a podium. It resets every Monday, so every week is a fresh start for everyone.',
  },
  {
    icon: 'respect',
    title: 'Recognition goes both ways',
    body: 'Give Respect or Inspired to the activities in your team’s feed. The recognition you receive becomes your Impact.',
  },
  {
    icon: 'crown',
    title: 'Your rank is earned each year',
    body: 'Effort moves you up the ranks through the year, from Rookie to Unrivaled. Everyone starts again on 1 January. Lifetime totals never reset.',
  },
];

export default function GettingStartedScreen() {
  const { welcome } = useLocalSearchParams<{ welcome?: string }>();
  const isWelcome = welcome === '1';
  const [strava, setStrava] = useState<boolean | null>(null);
  const [inTeam, setInTeam] = useState<boolean | null>(null);
  const [firstName, setFirstName] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { user } } = await getAuthUser();
      if (!user) return;
      const [conn, teams, profile] = await Promise.all([
        supabase.from('fitness_connections').select('user_id').eq('user_id', user.id).eq('provider', 'strava').maybeSingle(),
        supabase.from('league_members').select('league_id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'active'),
        supabase.from('users').select('display_name').eq('id', user.id).maybeSingle(),
      ]);
      setStrava(!!conn.data);
      loadStravaSharing();
      setInTeam((teams.count ?? 0) > 0);
      setFirstName(((profile.data?.display_name as string | undefined) ?? '').split(' ')[0]);
    })();
  }, []);

  const goHome = () => goToTab('/home');
  const back = () => (router.canGoBack() ? router.back() : goHome());

  return (
    <SafeAreaView style={rm.page} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={[rm.content, s.content]}>
        {isWelcome ? <View style={{ height: 8 }} /> : <RivalMobileHeader title="How RIVAL works" onBack={back} />}

        <View style={[rm.hero, s.hero]}>
          <View style={s.ruleRow}>
            <View style={[s.rule, s.ruleLeft]} />
            <Text style={s.ruleText}>{isWelcome ? 'Welcome to RIVAL' : 'How RIVAL works'}</Text>
            <View style={[s.rule, s.ruleRight]} />
          </View>
          <Text style={s.title}>{isWelcome && firstName ? `Welcome, ${firstName}` : 'We make each other better'}</Text>
          <Text style={s.lead}>
            RIVAL turns your training into Effort, and puts it alongside the people who keep you going.
          </Text>
        </View>

        {IDEAS.map((idea, i) => (
          <View key={idea.title} style={[rm.card, s.idea]}>
            <View style={rm.iconCircle}>
              <RivalIcon name={idea.icon} size={20} color={RivalColors.accentText} />
            </View>
            <View style={s.ideaText}>
              <Text style={rm.label}>Step {i + 1}</Text>
              <Text style={s.ideaTitle}>{idea.title}</Text>
              <Text style={rm.body}>{idea.body}</Text>
            </View>
          </View>
        ))}

        <Text style={[rm.label, s.sectionLabel]}>Get set up</Text>

        {strava ? (
          <DoneRow title="Strava connected" body="New activities sync automatically." />
        ) : (
          <RivalRowLink
            icon="refresh"
            title="Connect Strava"
            body="New activities sync automatically."
            onPress={() => startStravaConnect()}
          />
        )}
        <RivalRowLink
          icon="add"
          title="Add an activity yourself"
          body="Log a workout by hand or scan a screenshot."
          onPress={() => router.push('/add-workout')}
        />
        {!inTeam && readPendingInvite() ? (
          <RivalRowLink
            icon="groups"
            title="Join the team that invited you"
            body={`Invite code ${readPendingInvite()}`}
            onPress={() => router.push('/join-league')}
          />
        ) : null}
        {inTeam ? (
          <DoneRow title="You’re in a team" body="Your Effort counts towards its weekly podium." />
        ) : (
          <>
            <RivalRowLink
              icon="search"
              title="Find a team"
              body="Browse public teams, or join with an invite code."
              onPress={() => router.push('/discover-leagues')}
            />
            <RivalRowLink
              icon="flag"
              title="Create a team"
              body="Start one and invite the people you train with."
              onPress={() => router.push('/create-league')}
            />
          </>
        )}

        <TouchableOpacity style={[rm.primary, s.cta]} onPress={goHome} accessibilityRole="button">
          <Text style={rm.primaryText}>{isWelcome ? 'Go to Home' : 'Back to Home'}</Text>
        </TouchableOpacity>
        {isWelcome ? (
          <Text style={[rm.hint, s.footnote]}>You can come back to this from Profile at any time.</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function DoneRow({ title, body }: { title: string; body: string }) {
  return (
    <View style={[rm.card, s.doneRow]}>
      <View style={[rm.iconCircle, s.doneIcon]}>
        <RivalIcon name="check" size={20} color="#8fd6a4" />
      </View>
      <View style={s.ideaText}>
        <Text style={s.doneTitle}>{title}</Text>
        <Text style={rm.hint}>{body}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  content: { maxWidth: 560, width: '100%', alignSelf: 'center', paddingBottom: 120 },
  hero: { alignItems: 'center', paddingVertical: 28 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  rule: { width: 28, height: 1, backgroundColor: 'rgba(255,181,158,0.35)' },
  ruleLeft: {},
  ruleRight: {},
  ruleText: { fontSize: 11, fontWeight: '800', letterSpacing: 2.2, textTransform: 'uppercase', color: RivalColors.accentText },
  title: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 28, lineHeight: 34, color: '#fff', textAlign: 'center' },
  lead: { fontSize: 14.5, lineHeight: 21, color: RivalWarm.soft, textAlign: 'center', maxWidth: 320 },
  idea: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  ideaText: { flex: 1, gap: 4 },
  ideaTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 18, lineHeight: 23, color: '#fff' },
  sectionLabel: { marginTop: 10, marginLeft: 4 },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  doneIcon: { backgroundColor: 'rgba(143,214,164,0.12)' },
  doneTitle: { fontSize: 15, fontWeight: '700', color: '#fff' },
  cta: { marginTop: 10 },
  footnote: { textAlign: 'center' },
});
