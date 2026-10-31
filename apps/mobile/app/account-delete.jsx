import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Switch, View } from 'react-native';
import { api } from '../src/api.js';
import { useAuth } from '../src/auth.jsx';
import { SignInPrompt } from '../src/SignInPrompt.jsx';
import { colors } from '../src/theme.js';
import { Button, Card, DetailSkeleton, ErrorView, Field, Icon, Muted, s, Text, useApi } from '../src/ui.jsx';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Same three steps as the website: review what happens, confirm with a fresh code sent to the
// account's own email or WhatsApp number, then type DELETE. Nothing changes until the API
// confirms, and the success screen shows what the API reports.
export default function DeleteAccount() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const summary = useApi(user ? '/me/deletion' : null);
  const [step, setStep] = useState('review');
  const [understood, setUnderstood] = useState(false);
  const [challenge, setChallenge] = useState(null);
  const [channel, setChannel] = useState(null);
  const [code, setCode] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [pending, setPending] = useState(null);
  const [result, setResult] = useState(null);

  if (result) {
    return (
      <ScrollView contentContainerStyle={[s.screen, { alignItems: 'center', paddingTop: 48 }]}>
        <View style={[s.iconBubble, { width: 64, height: 64, borderRadius: 32 }]}>
          <Icon name="check-circle" size={30} color={colors.teal700} />
        </View>
        <Text style={[s.h1, { textAlign: 'center' }]} accessibilityRole="header">
          Your account is scheduled for deletion
        </Text>
        <Muted style={{ textAlign: 'center' }}>
          You’ve been signed out on every device.{result.cancelledBookings ? ` ${plural(result.cancelledBookings, 'upcoming appointment')} cancelled and the businesses notified.` : ''} Changed your mind? Sign in with a one-time code within 15 days and choose “Restore my account”.
        </Muted>
        <Button title="Done" onPress={() => router.replace('/')} style={{ alignSelf: 'stretch', marginTop: 12 }} />
      </ScrollView>
    );
  }
  if (!user) return <SignInPrompt icon="user" title="Sign in to manage your account" />;
  if (summary.error && !summary.data) return <ErrorView error={summary.error} onRetry={summary.reload} />;
  if (!summary.data) return <DetailSkeleton label="Checking your account" />;

  const { counts: c, policy, channels } = summary.data;
  const chosen = channel ?? channels[0];

  const sendCode = async () => {
    setPending('code');
    try {
      const { data } = await api('/me/deletion/challenge', { method: 'POST', body: { channel: chosen } });
      setChallenge(data);
      setCode('');
    } catch (err) {
      Alert.alert('Code not sent', err.message);
    } finally {
      setPending(null);
    }
  };

  const remove = async () => {
    setPending('delete');
    try {
      const { data } = await api('/me/deletion', { method: 'POST', body: { channel: challenge.channel, challengeId: challenge.challengeId, code, confirm: 'DELETE' } });
      setResult(data);
      await logout();
    } catch (err) {
      Alert.alert('Account not deleted', err.message);
      setPending(null);
    }
  };

  if (step === 'review') {
    return (
      <ScrollView contentContainerStyle={s.screen}>
        <Text style={s.h1} accessibilityRole="header">
          Delete your account
        </Text>
        <Muted>You can restore it within 15 days by signing in with a one-time code. After that it is permanent. Here is exactly what happens.</Muted>
        {c.upcomingBookings > 0 ? (
          <Card style={{ backgroundColor: colors.amber50, borderColor: '#F6D58F', gap: 4 }}>
            <Text style={{ color: colors.amberText, fontWeight: '700' }}>{plural(c.upcomingBookings, 'upcoming appointment')} will be cancelled</Text>
            <Text style={{ color: colors.amberText }}>Each business is told the booking was cancelled because you deleted your account.</Text>
          </Card>
        ) : null}
        <PolicyCard title={`Deleted after ${policy.recoveryDays ?? 15} days`} items={policy.deleted} color={colors.danger} />
        <PolicyCard title="Cancelled now" items={policy.cancelled} color={colors.amber} />
        <PolicyCard title="Kept without your name or contact details" items={policy.retained} color={colors.subtle} />
        <Muted>
          For this account: {plural(c.reviews, 'review')} and {plural(c.favorites, 'saved business', 'saved businesses')} deleted, {plural(c.pastBookings, 'past appointment')} kept anonymously, {plural(c.openTickets, 'open support request')} closed.
        </Muted>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Switch accessibilityLabel="I understand my account is deleted for good after 15 days" value={understood} onValueChange={setUnderstood} trackColor={{ true: colors.danger }} />
          <Text style={{ flex: 1, color: colors.navy }}>I understand my account is deleted for good after 15 days</Text>
        </View>
        {channels.length === 0 ? <Muted style={{ color: colors.danger }}>Add and verify an email or phone number on the TownAnt website first.</Muted> : null}
        <Button title="Continue" variant="danger" disabled={!understood || channels.length === 0} onPress={() => setStep('verify')} />
        <Button title="Keep my account" variant="secondary" onPress={() => router.back()} />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      <Text style={s.h2} accessibilityRole="header">
        1. Confirm it’s you
      </Text>
      <Muted>We’ll send a one-time code to the {chosen === 'whatsapp' ? 'WhatsApp number' : 'email address'} on your account.</Muted>
      {channels.length > 1 && !challenge ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {channels.map((ch) => (
            <Button key={ch} size="sm" title={ch === 'email' ? 'Email' : 'WhatsApp'} variant={chosen === ch ? 'primary' : 'secondary'} onPress={() => setChannel(ch)} style={{ flex: 1 }} />
          ))}
        </View>
      ) : null}
      {challenge ? <Field label={`Code sent to ${challenge.maskedDestination}`} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6} required /> : null}
      <Button title={challenge ? 'Send a new code' : 'Send code'} variant="secondary" pending={pending === 'code'} onPress={sendCode} />
      <Text style={[s.h2, { marginTop: 8 }]} accessibilityRole="header">
        2. Final confirmation
      </Text>
      <Field label="Type DELETE to confirm" value={confirmText} onChangeText={setConfirmText} autoCapitalize="characters" autoCorrect={false} required />
      <Button title="Delete my account" variant="danger" icon="trash-2" pending={pending === 'delete'} disabled={!challenge || code.length !== 6 || confirmText.trim() !== 'DELETE'} onPress={remove} />
      <Button title="Back" variant="ghost" disabled={pending === 'delete'} onPress={() => setStep('review')} />
    </ScrollView>
  );
}

function PolicyCard({ title, items, color }) {
  return (
    <Card style={{ gap: 8 }}>
      <Text style={s.h2}>{title}</Text>
      {items.map((i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, marginTop: 7 }} />
          <Text style={{ flex: 1, color: colors.slate, lineHeight: 20 }}>{i}</Text>
        </View>
      ))}
    </Card>
  );
}
