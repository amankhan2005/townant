import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useAuth } from '../src/auth.jsx';
import { accents, colors, radius, text } from '../src/theme.js';
import { Icon, ListRow, Text } from '../src/ui.jsx';

// Help & Support hub (public). Contacting the team follows the existing support rules: requests
// need a signed-in customer so replies can reach them.
export default function Help() {
  const router = useRouter();
  const { user } = useAuth();
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 18 }}>
      <View style={[styles.panel, { padding: 18, backgroundColor: colors.navy, borderColor: colors.navy, gap: 6 }]}>
        <Icon name="life-buoy" size={26} color={colors.teal300} />
        <Text style={[text.title, { color: colors.white }]} accessibilityRole="header">
          How can we help?
        </Text>
        <Text style={[text.body, { color: 'rgba(255,255,255,0.85)' }]}>Find answers, or send a request to the TownAnt team.</Text>
      </View>
      <View style={styles.panel}>
        <ListRow icon="help-circle" title="FAQs" subtitle="Booking, sign-in, saving and cancellations" accent={accents.green} onPress={() => router.push('/faq')} />
        <ListRow icon="message-circle" title="Contact us" subtitle={user ? 'Replies arrive in My support requests' : 'You’ll sign in first so we can reply to you'} accent={accents.teal} onPress={() => router.push('/support/new')} last={!user} />
        {user ? <ListRow icon="inbox" title="My support requests" accent={accents.blue} onPress={() => router.push('/support')} last /> : null}
      </View>
      <View style={styles.panel}>
        <ListRow icon="file-text" title="Terms & Conditions" accent={accents.blue} onPress={() => router.push('/legal/terms')} />
        <ListRow icon="lock" title="Privacy Policy" accent={accents.violet} onPress={() => router.push('/legal/privacy')} last />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
});
