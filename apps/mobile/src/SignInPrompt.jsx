import { useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { colors, text } from './theme.js';
import { Button, Icon, s, Text } from './ui.jsx';

// Shown in place of account-only screens (bookings, saved, notifications, support). Browsing
// never needs an account; this explains why this particular screen does and opens sign-in, which
// returns here afterwards.
export function SignInPrompt({ title = 'Sign in to continue', text: body, icon = 'user', reason, points = [] }) {
  const router = useRouter();
  return (
    <ScrollView contentContainerStyle={[s.screen, { flexGrow: 1, justifyContent: 'center', paddingVertical: 32 }]}>
      <View style={[s.card, { alignItems: 'center', gap: 10, paddingVertical: 28, paddingHorizontal: 22 }]}>
        <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: colors.teal50, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={28} color={colors.teal700} />
        </View>
        <Text style={[text.heading, { color: colors.navy, textAlign: 'center' }]} accessibilityRole="header">
          {title}
        </Text>
        {body ? <Text style={[text.body, { color: colors.muted, textAlign: 'center' }]}>{body}</Text> : null}
        {points.length ? (
          <View style={{ alignSelf: 'stretch', gap: 8, marginTop: 4 }}>
            {points.map((p) => (
              <View key={p} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                <Icon name="check" size={16} color={colors.teal} style={{ marginTop: 3 }} />
                <Text style={[text.body, { flex: 1 }]}>{p}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <Button title="Sign in or create account" onPress={() => router.push({ pathname: '/login', params: reason ? { reason } : {} })} style={{ alignSelf: 'stretch', marginTop: 8 }} />
        <Button title="Keep browsing" variant="ghost" onPress={() => router.navigate('/')} style={{ alignSelf: 'stretch' }} />
        <Text style={[text.caption, { color: colors.muted, textAlign: 'center' }]}>No password needed — we send a one-time code to your email or WhatsApp.</Text>
      </View>
    </ScrollView>
  );
}
