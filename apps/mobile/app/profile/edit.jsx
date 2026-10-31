import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { api } from '../../src/api.js';
import { useAuth } from '../../src/auth.jsx';
import { SignInPrompt } from '../../src/SignInPrompt.jsx';
import { colors, radius, text } from '../../src/theme.js';
import { Button, Field, Muted, Text } from '../../src/ui.jsx';

export default function EditProfile() {
  const { user } = useAuth();
  if (!user) return <SignInPrompt icon="user" title="Sign in to edit your profile" />;
  // Keyed by account so the next person to sign in on this device never inherits (or saves) the
  // previous account's name.
  return <EditForm key={user.id} />;
}

function EditForm() {
  const { user, refresh } = useAuth();
  const router = useRouter();
  const [name, setName] = useState(user.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api('/me', { method: 'PATCH', body: { displayName: name.trim() } });
      await refresh();
      router.back();
    } catch (err) {
      Alert.alert('Not saved', err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
      <View style={styles.panel}>
        <Field label="Display name" value={name} onChangeText={setName} maxLength={80} autoComplete="name" hint="Shown to businesses you book with." returnKeyType="done" onSubmitEditing={() => name.trim() && save()} />
        <Button title="Save" onPress={save} pending={saving} disabled={!name.trim() || name.trim() === (user.displayName ?? '')} />
      </View>
      <View style={[styles.panel, { gap: 6 }]}>
        <Text style={[text.label, { color: colors.navy }]}>Sign-in methods</Text>
        <Muted>Email: {user.email ?? 'not added'}</Muted>
        <Muted>Mobile: {user.phone ?? 'not added'}</Muted>
        <Muted style={{ fontSize: 12 }}>Add or change these on the TownAnt website (requires a verification code).</Muted>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 14 },
});
