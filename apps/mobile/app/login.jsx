import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { api } from '../src/api.js';
import { useAuth } from '../src/auth.jsx';
import { colors, text } from '../src/theme.js';
import { Button, Field, FormMessage, Icon, Muted, s, Text } from '../src/ui.jsx';

const mark = require('../assets/adaptive-icon.png');

// Why the visitor is being asked to sign in — shown at the top so the request never feels random.
const REASONS = {
  book: ['Sign in to send your booking', 'Your booking details are saved. We’ll send it as soon as you’re signed in.'],
  bookings: ['Sign in to see your bookings', null],
  support: ['Sign in to contact TownAnt', 'So we can reply to you and keep your request history in one place.'],
};

// Passwordless sign-in with ONE channel of the customer's choice: email or WhatsApp.
export default function Login() {
  const router = useRouter();
  const { reason } = useLocalSearchParams();
  const { channels, signedIn } = useAuth();
  const [channel, setChannel] = useState('email');
  const [value, setValue] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const destination = channel === 'email' ? { email: value.trim() } : { phone: value.trim() };
  const [title, subtitle] = REASONS[reason] ?? ['Welcome to TownAnt', 'Sign in or create an account — no password needed.'];
  const done = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const send = async () => {
    setPending(true);
    setError(null);
    try {
      const { data } = await api('/auth/otp/request', { method: 'POST', body: { channel, ...destination } });
      setChallenge(data);
    } catch (err) {
      const wait = err.code === 'OTP_COOLDOWN' ? err.details?.retryAfterSeconds : null;
      setError(wait ? `A code was just sent. You can request another in ${wait} second${wait === 1 ? '' : 's'}.` : err.message);
    } finally {
      setPending(false);
    }
  };
  const verify = async () => {
    setPending(true);
    setError(null);
    try {
      const { data } = await api('/auth/otp/verify', { method: 'POST', body: { channel, ...destination, challengeId: challenge.challengeId, code, transport: 'bearer', displayName: name.trim() || undefined } });
      await signedIn(data);
      done();
    } catch (err) {
      if (err.code === 'ACCOUNT_PENDING_DELETION') offerRestore(err.details);
      else setError(err.message);
    } finally {
      setPending(false);
    }
  };
  // The code was correct, but the account is pending deletion: restore only if the customer confirms.
  const offerRestore = (details) => {
    const until = details?.recoverUntil ? new Date(details.recoverUntil) : null;
    const date = until ? `${String(until.getMonth() + 1).padStart(2, '0')}/${String(until.getDate()).padStart(2, '0')}/${until.getFullYear()}` : null;
    Alert.alert('Account scheduled for deletion', `You asked to delete this account${date ? `; it will be permanently deleted on ${date}` : ''}. Restore it to keep your saved businesses and history.`, [
      { text: 'Keep it deleted', style: 'cancel', onPress: () => setChallenge(null) },
      {
        text: 'Restore my account',
        onPress: async () => {
          try {
            const { data } = await api('/auth/account/restore', { method: 'POST', body: { restoreToken: details.restoreToken, confirm: 'RESTORE', transport: 'bearer' } });
            await signedIn(data);
            done();
          } catch (e) {
            setError(e.message);
          }
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.cloud }}>
      <ScrollView contentContainerStyle={[s.screen, { paddingTop: 8 }]} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <Image source={mark} style={{ width: 72, height: 72 }} accessibilityIgnoresInvertColors />
          <Text style={[text.title, { color: colors.navy, textAlign: 'center' }]} accessibilityRole="header">
            {challenge ? 'Enter your code' : title}
          </Text>
          <Muted style={{ textAlign: 'center' }}>{challenge ? `We sent a 6-digit code to ${challenge.maskedDestination}. It expires in 10 minutes.` : subtitle}</Muted>
        </View>

        <View style={[s.card, { gap: 14 }]}>
          {!challenge ? (
            <>
              <View style={{ flexDirection: 'row', backgroundColor: colors.cloud, borderRadius: 14, padding: 4 }} accessibilityRole="tablist">
                {[
                  ['email', 'Email', 'mail'],
                  ['whatsapp', 'WhatsApp', 'message-circle'],
                ].map(([k, label, icon]) => {
                  const on = channel === k;
                  return (
                    <Pressable
                      key={k}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: on, disabled: !channels[k] }}
                      disabled={!channels[k]}
                      onPress={() => {
                        setChannel(k);
                        setValue('');
                        setError(null);
                      }}
                      style={{ flex: 1, flexDirection: 'row', gap: 6, minHeight: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? colors.white : 'transparent', opacity: channels[k] ? 1 : 0.4, ...(on ? { elevation: 2, shadowColor: colors.navy, shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } } : null) }}
                    >
                      <Icon name={icon} size={16} color={on ? colors.teal700 : colors.muted} />
                      <Text style={[text.label, { color: on ? colors.teal700 : colors.muted }]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {channel === 'email' ? (
                <Field key="email" label="Email address" value={value} onChangeText={setValue} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" placeholder="you@example.com" returnKeyType="send" onSubmitEditing={() => value.trim() && send()} />
              ) : (
                <Field key="phone" label="Mobile number" value={value} onChangeText={setValue} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder="+1 512 555 0100" hint="Include your country code. The code arrives on WhatsApp." />
              )}
              {error ? <FormMessage text={error} /> : null}
              <Button title="Send code" icon="send" onPress={send} pending={pending} disabled={!value.trim()} />
            </>
          ) : (
            <>
              <Field label="Verification code" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" autoFocus />
              <Field label="Your name (optional)" value={name} onChangeText={setName} maxLength={80} autoComplete="name" hint="Shown to businesses you book with." />
              {error ? <FormMessage text={error} /> : null}
              <Button title="Verify and continue" onPress={verify} pending={pending} disabled={code.length !== 6} />
              <Button
                title="Use a different email or number"
                variant="ghost"
                onPress={() => {
                  setChallenge(null);
                  setCode('');
                  setError(null);
                }}
              />
            </>
          )}
        </View>

        <Text style={[text.caption, { color: colors.muted, textAlign: 'center', lineHeight: 18 }]}>
          By continuing you agree to TownAnt’s{' '}
          <Text style={{ color: colors.teal700, fontWeight: '700' }} accessibilityRole="link" onPress={() => router.push('/legal/terms')}>
            Terms & Conditions
          </Text>{' '}
          and acknowledge the{' '}
          <Text style={{ color: colors.teal700, fontWeight: '700' }} accessibilityRole="link" onPress={() => router.push('/legal/privacy')}>
            Privacy Policy
          </Text>
          .
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
