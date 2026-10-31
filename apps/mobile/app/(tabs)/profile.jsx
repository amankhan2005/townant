import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useAuth } from '../../src/auth.jsx';
import { initials } from '../../src/format.js';
import { useSearchLocation } from '../../src/location.jsx';
import { accents, colors, radius, text } from '../../src/theme.js';
import { Button, Icon, ListRow, Muted, Text } from '../../src/ui.jsx';

// Profile: account features and the public help & legal pages, in a few clear groups.
export default function Profile() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const location = useSearchLocation();
  const go = (path) => () => router.push(path);

  const confirmLogout = () =>
    Alert.alert('Log out of TownAnt?', 'You can keep browsing, and businesses saved on this device stay saved.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.navigate('/');
        },
      },
    ]);

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      {user ? (
        <View style={[styles.panel, { padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
          <View style={styles.avatar}>
            <Text style={[text.heading, { color: colors.white }]}>{initials(user)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[text.heading, { color: colors.navy }]} numberOfLines={1}>
              {user.displayName || 'Add your name'}
            </Text>
            <Text style={[text.secondary, { color: colors.muted }]} numberOfLines={1}>
              {user.email ?? user.phone}
            </Text>
          </View>
          <Button title="Edit" size="sm" variant="soft" onPress={go('/profile/edit')} />
        </View>
      ) : (
        <View style={[styles.panel, { padding: 20, gap: 12 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={[styles.avatar, { backgroundColor: colors.teal50 }]}>
              <Icon name="user" size={26} color={colors.teal700} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[text.heading, { color: colors.navy }]}>Welcome to TownAnt</Text>
              <Muted>You’re browsing as a guest.</Muted>
            </View>
          </View>
          {['Book appointments and get confirmations', 'Keep saved businesses on every device', 'Follow your bookings and support requests'].map((b) => (
            <View key={b} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <Icon name="check-circle" size={16} color={colors.teal} />
              <Text style={[text.body, { color: colors.slate, flex: 1 }]}>{b}</Text>
            </View>
          ))}
          <Button title="Sign in / Create account" onPress={go('/login')} style={{ marginTop: 4 }} />
          <Text style={[text.caption, { color: colors.muted, textAlign: 'center' }]}>No password — we send a one-time code to your email or WhatsApp.</Text>
        </View>
      )}

      {user ? (
        <>
          <Group title="Your activity">
            <ListRow icon="calendar" title="My bookings" accent={accents.teal} onPress={() => router.navigate({ pathname: '/bookings', params: { when: 'upcoming' } })} />
            <ListRow icon="clock" title="Booking history" accent={accents.blue} onPress={() => router.navigate({ pathname: '/bookings', params: { when: 'past' } })} />
            <ListRow icon="bell" title="Notifications" accent={accents.amber} onPress={go('/notifications')} />
            <ListRow icon="heart" title="Saved businesses" accent={accents.rose} onPress={() => router.navigate('/favorites')} last />
          </Group>
          <Group title="Account">
            <ListRow icon="edit-3" title="Edit profile" accent={accents.violet} onPress={go('/profile/edit')} />
            <ListRow icon="settings" title="Account settings" subtitle="Notifications, sign-in methods, delete account" accent={accents.sky} onPress={go('/settings')} last />
          </Group>
        </>
      ) : null}

      <Group title="Help & information">
        <ListRow icon="life-buoy" title="Help & Support" accent={accents.teal} onPress={go('/help')} />
        <ListRow icon="help-circle" title="FAQs" accent={accents.green} onPress={go('/faq')} />
        <ListRow icon="message-circle" title="Contact us" accent={accents.sky} onPress={go('/support/new')} />
        <ListRow icon="file-text" title="Terms & Conditions" accent={accents.blue} onPress={go('/legal/terms')} />
        <ListRow icon="lock" title="Privacy Policy" accent={accents.violet} onPress={go('/legal/privacy')} />
        <ListRow icon="info" title="About TownAnt" accent={accents.amber} onPress={go('/about')} last />
      </Group>

      <Group title="App">
        <ListRow icon="map-pin" title="Location" subtitle={location.label} accent={accents.orange} onPress={location.openPicker} last={!user} />
        {user ? <ListRow icon="log-out" title="Log out" danger onPress={confirmLogout} last /> : null}
      </Group>

      <Muted style={{ textAlign: 'center', fontSize: 12 }}>TownAnt never takes payments — you pay businesses directly.{'\n'}Version {Constants.expoConfig?.version ?? '—'}</Muted>
    </ScrollView>
  );
}

function Group({ title, children }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={[text.overline, { color: colors.muted, marginLeft: 4 }]}>{title}</Text>
      <View style={styles.panel}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 16, gap: 20, paddingBottom: 48 },
  panel: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  avatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.teal, alignItems: 'center', justifyContent: 'center' },
});
