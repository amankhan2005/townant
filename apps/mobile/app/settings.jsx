import { useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { api } from '../src/api.js';
import { useAuth } from '../src/auth.jsx';
import { registerForPush } from '../src/push.js';
import { SignInPrompt } from '../src/SignInPrompt.jsx';
import { colors, radius, text } from '../src/theme.js';
import { Button, Muted, Text } from '../src/ui.jsx';

// Account settings: how booking updates reach the customer, sign-in methods, account deletion.
export default function Settings() {
  const { user, refresh } = useAuth();
  const router = useRouter();
  if (!user) return <SignInPrompt icon="settings" title="Sign in to manage your account" />;

  const savePrefs = async (patch) => {
    try {
      await api('/me', { method: 'PATCH', body: { notificationPrefs: patch } });
      if (patch.push) {
        const result = await registerForPush();
        if (!result.ok) Alert.alert('Push notifications', result.reason);
      }
      await refresh();
    } catch (err) {
      Alert.alert('Not saved', err.message);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 48 }}>
      <View style={{ gap: 8 }}>
        <Text style={[text.overline, { color: colors.muted, marginLeft: 4 }]}>Booking updates</Text>
        <View style={[styles.panel, { paddingVertical: 4 }]}>
          {[
            ['push', 'Push notifications'],
            ['email', 'Email'],
          ].map(([k, label], i) => (
            <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderColor: colors.line }}>
              <Text style={[text.bodyStrong, { color: colors.navy }]}>{label}</Text>
              <Switch accessibilityLabel={label} value={user.notificationPrefs[k]} onValueChange={(v) => savePrefs({ [k]: v })} trackColor={{ true: colors.teal, false: colors.lineStrong }} thumbColor={colors.white} />
            </View>
          ))}
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <Text style={[text.overline, { color: colors.muted, marginLeft: 4 }]}>Sign-in methods</Text>
        <View style={[styles.panel, { padding: 16, gap: 6 }]}>
          <Muted>Email: {user.email ?? 'not added'}</Muted>
          <Muted>Mobile: {user.phone ?? 'not added'}</Muted>
          <Muted style={{ fontSize: 12 }}>Add or change these on the TownAnt website (requires a verification code).</Muted>
        </View>
      </View>
      <View style={[styles.panel, { padding: 16, gap: 8, borderColor: '#F3C5C0' }]}>
        <Text style={[text.cardTitle, { color: colors.navy }]}>Delete account</Text>
        <Muted>Permanently delete your account and personal details. You’ll see exactly what happens before anything is deleted.</Muted>
        <Button title="Delete my account" icon="trash-2" variant="dangerGhost" onPress={() => router.push('/account-delete')} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
});
