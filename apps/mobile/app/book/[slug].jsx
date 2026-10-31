import { daysInMonth, formatIsoDate, isoDateInZone, todayIso, weekdayShortOfIso } from '@townant/shared';
import { Stack, useFocusEffect, useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, newIdempotencyKey } from '../../src/api.js';
import { useAuth } from '../../src/auth.jsx';
import { Calendar } from '../../src/Calendar.jsx';
import { clearPendingBooking, loadPendingBooking, savePendingBooking } from '../../src/pendingBooking.js';
import { registerForPush } from '../../src/push.js';
import { accents, colors, fonts, radii, radius, shadow, text } from '../../src/theme.js';
import { Button, Card, ErrorView, FormMessage, formatDateTime, Icon, LoadingGroup, Muted, s, Skeleton, Text, useApi } from '../../src/ui.jsx';

const PERIODS = [
  ['Morning', 'sunrise', (h) => h < 12],
  ['Afternoon', 'sun', (h) => h >= 12 && h < 17],
  ['Evening', 'moon', (h) => h >= 17],
];
const hourOf = (t) => {
  const [, h, , ap] = t.match(/^(\d+):(\d+) (AM|PM)$/) ?? [];
  return (Number(h) % 12) + (ap === 'PM' ? 12 : 0);
};

// Choose → review → confirm. Everything up to the final confirmation works without an account.
// Confirming while signed out saves the booking on the device (pendingBooking.js) and opens sign-in;
// when the customer comes back signed in it is sent automatically. The idempotency key travels with
// it, so retries and repeated taps create at most one booking, and the server re-validates the slot.
export default function Book() {
  const { slug, serviceId, title, tz, company, duration, mode, price } = useLocalSearchParams();
  const zone = typeof tz === 'string' && tz ? tz : 'UTC';
  const router = useRouter();
  const { user } = useAuth();
  const today = todayIso(zone);
  const [view, setView] = useState(`${today.slice(0, 8)}01`);
  const [date, setDate] = useState(null);
  const [slot, setSlot] = useState(null);
  const [note, setNote] = useState('');
  const [step, setStep] = useState('choose');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const key = useRef(newIdempotencyKey());
  const submitting = useRef(false);
  const [createdId, setCreatedId] = useState(null);
  const request = mode === 'request';

  const [y, m] = view.split('-').map(Number);
  const from = view < today ? today : view;
  const days = Math.min(31, daysInMonth(y, m) - Number(from.slice(8)) + 1);
  const summary = useApi(`/catalog/companies/${slug}/availability`, { serviceId, from, days }, [refresh]);
  const counts = useMemo(() => new Map((summary.data?.days ?? []).map((d) => [d.date, d.openSlots])), [summary.data]);
  const selected = date ?? summary.data?.days.find((d) => d.openSlots > 0)?.date ?? null;
  const slots = useApi(selected && step === 'choose' ? `/catalog/companies/${slug}/slots` : null, { serviceId, date: selected }, [refresh]);
  const grouped = PERIODS.map(([label, icon, test]) => [label, icon, (slots.data?.slots ?? []).filter((t) => test(hourOf(t.localTime)))]).filter(([, , l]) => l.length);

  // A booking saved before sign-in (or before the app was closed) for this service picks up where
  // it left off, at the review step.
  useEffect(() => {
    let live = true;
    loadPendingBooking().then((p) => {
      if (!live || !p || p.slug !== slug || p.serviceId !== serviceId) return;
      const day = isoDateInZone(p.slot.startAt, zone);
      setView(`${day.slice(0, 8)}01`);
      setDate(day);
      setSlot(p.slot);
      setNote(p.note ?? '');
      key.current = p.key;
      setStep('review');
    });
    return () => {
      live = false;
    };
  }, [slug, serviceId, zone]);

  // Back from the review step returns to choosing, rather than closing the booking.
  usePreventRemove(step === 'review' && !createdId && !busy, () => setStep('choose'));
  // Once the booking exists, show it (prevention is already off for this render).
  useEffect(() => {
    if (createdId) router.replace({ pathname: `/bookings/${createdId}`, params: { created: '1' } });
  }, [createdId, router]);

  const submit = async () => {
    if (submitting.current || !slot) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const { data } = await api('/bookings', { method: 'POST', headers: { 'Idempotency-Key': key.current }, body: { serviceId, startAt: slot.startAt, note: note.trim() || undefined } });
      await clearPendingBooking();
      // Ask for push permission at the moment it is clearly useful.
      if (user?.notificationPrefs?.push !== false) registerForPush().catch(() => {});
      setCreatedId(data.id);
    } catch (err) {
      setError(err.message);
      if (err.code === 'SLOT_UNAVAILABLE') {
        setSlot(null);
        setStep('choose');
        setRefresh((r) => r + 1);
        key.current = newIdempotencyKey();
        await clearPendingBooking();
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  // The latest `submit` and user, for the focus effect below.
  const submitRef = useRef(submit);
  const userRef = useRef(user);
  useEffect(() => {
    submitRef.current = submit;
    userRef.current = user;
  });
  // 'pushed' when sign-in was opened for this booking, 'away' once this screen lost focus to it.
  const signIn = useRef('no');

  const confirm = async () => {
    if (user) return submit();
    await savePendingBooking({ slug, serviceId, title, tz: zone, company, duration, mode, price, slot, note: note.trim(), key: key.current });
    signIn.current = 'pushed';
    router.push({ pathname: '/login', params: { reason: 'book' } });
    return undefined;
  };

  // Back from sign-in: send the saved booking if the customer is now signed in; if they backed out
  // of sign-in, nothing is sent and the review stays on screen. Runs only on real focus changes.
  useFocusEffect(
    useCallback(() => {
      if (signIn.current === 'away') {
        signIn.current = 'no';
        setTimeout(() => {
          if (userRef.current) submitRef.current();
        }, 0);
      }
      return () => {
        if (signIn.current === 'pushed') signIn.current = 'away';
      };
    }, []),
  );

  const header = (
    <View style={{ gap: 2 }}>
      {company ? <Text style={[text.overline, { color: colors.teal700 }]}>{company}</Text> : null}
      <Text style={[text.title, { color: colors.navy }]} accessibilityRole="header">
        {title}
      </Text>
      <Muted>{[duration ? `${duration} min` : null, price || null, `times in ${zone.replaceAll('_', ' ')}`].filter(Boolean).join(' · ')}</Muted>
    </View>
  );

  if (step === 'review' && slot) {
    const rows = [
      ['briefcase', 'Business', company, accents.teal],
      ['scissors', 'Service', [title, duration ? `${duration} min` : null].filter(Boolean).join(' · '), accents.magenta],
      ['calendar', 'Date and time', formatDateTime(slot.startAt, zone), accents.blue],
      price ? ['tag', 'Price', `${price} — pay the business directly`, accents.amber] : null,
      ['edit-3', 'Your note', note.trim() || 'No note', accents.violet],
    ].filter(Boolean);
    return (
      <View style={{ flex: 1 }}>
        <Stack.Screen options={{ title: 'Review booking' }} />
        <ScrollView contentContainerStyle={[s.screen, { paddingBottom: 140 }]}>
          <Text style={[text.title, { color: colors.navy }]} accessibilityRole="header">
            Check your booking
          </Text>
          <View style={styles.panel}>
            {rows.map(([icon, label, value, accent], i) => (
              <View key={label} style={{ flexDirection: 'row', gap: 12, padding: 14, borderTopWidth: i ? 1 : 0, borderColor: colors.line }}>
                <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: accent.bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={icon} size={17} color={accent.fg} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[text.caption, { color: colors.muted }]}>{label}</Text>
                  <Text style={[text.bodyStrong, { color: colors.navy }]}>{value}</Text>
                </View>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 10, backgroundColor: request ? colors.amber50 : colors.teal50, borderRadius: 14, padding: 12 }}>
            <Icon name={request ? 'send' : 'zap'} size={16} color={request ? colors.amberText : colors.teal700} style={{ marginTop: 2 }} />
            <Text style={[text.secondary, { color: request ? colors.amberText : colors.teal700, flex: 1, fontSize: 14, lineHeight: 20 }]}>
              {request ? 'This business confirms requests. You’ll be notified when they reply.' : 'This time is reserved for you as soon as you confirm.'}
            </Text>
          </View>
          {error ? <FormMessage text={error} /> : null}
          {!user ? <Muted style={{ fontSize: 13 }}>Next, you’ll verify your email or WhatsApp with a one-time code. Your booking is kept and sent as soon as you’re signed in.</Muted> : null}
        </ScrollView>
        <SafeAreaView edges={['bottom']} style={styles.bar}>
          <Button title="Edit" variant="secondary" onPress={() => setStep('choose')} disabled={busy} style={{ paddingHorizontal: 18 }} />
          <Button title={busy ? 'Sending…' : user ? (request ? 'Send request' : 'Confirm booking') : request ? 'Sign in & send request' : 'Sign in & confirm'} icon={user ? 'check' : 'log-in'} onPress={confirm} pending={busy} style={{ flex: 1 }} />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: 'Choose a time' }} />
      <ScrollView contentContainerStyle={[s.screen, { paddingBottom: 120 }]} keyboardShouldPersistTaps="handled">
        {header}
        <Card style={{ paddingHorizontal: 8 }}>
          <Calendar
            value={selected}
            min={today}
            timeZone={zone}
            onViewChange={setView}
            onSelect={(iso) => {
              setDate(iso);
              setSlot(null);
            }}
            isDisabled={(iso) => counts.has(iso) && counts.get(iso) === 0}
            meta={(iso) => (counts.has(iso) ? (counts.get(iso) > 0 ? { short: `${counts.get(iso)} open`, label: `${counts.get(iso)} open times` } : { short: 'Full', label: 'no open times' }) : null)}
          />
          {summary.loading && !summary.data ? <Muted style={{ textAlign: 'center', paddingBottom: 6 }}>Checking availability…</Muted> : null}
        </Card>
        {summary.error && !summary.data ? <ErrorView error={summary.error} onRetry={summary.reload} title="Availability didn't load" /> : null}

        <Text style={[text.heading, { color: colors.navy }]} accessibilityRole="header">
          {selected ? `${weekdayShortOfIso(selected)}, ${formatIsoDate(selected)}` : 'Choose a day'}
        </Text>
        {selected && !slots.data && !slots.error ? (
          <LoadingGroup label="Loading available times" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} style={{ width: '31%', height: 46, borderRadius: radii.md }} />
            ))}
          </LoadingGroup>
        ) : null}
        {slots.error && !slots.data ? <ErrorView error={slots.error} onRetry={slots.reload} title="Times didn't load" /> : null}
        {!selected && summary.data ? <Muted>No open days left this month. Tap › for next month.</Muted> : null}
        {slots.data && slots.data.slots.length === 0 ? <Muted>No open times on {formatIsoDate(selected)}. Choose another day.</Muted> : null}
        {grouped.map(([label, icon, list]) => (
          <View key={label} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name={icon} size={14} color={colors.muted} />
              <Text style={[text.overline, { color: colors.muted }]}>{label}</Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {list.map((t) => {
                const on = slot?.startAt === t.startAt;
                return (
                  <Pressable key={t.startAt} onPress={() => setSlot(t)} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${t.localTime} on ${formatIsoDate(selected)}`} style={[styles.slot, on && { borderColor: colors.teal, backgroundColor: colors.teal }]}>
                    <Text style={[text.label, { color: on ? colors.white : colors.navy }]}>{t.localTime}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        {slot ? (
          <View style={{ gap: 6 }}>
            <Text style={[text.label, { color: colors.navy }]}>Note for the business (optional)</Text>
            <TextInput value={note} onChangeText={setNote} placeholder="Anything they should know before your visit" placeholderTextColor={colors.subtle} multiline maxLength={1000} accessibilityLabel="Note for the business, optional" style={[s.input, { minHeight: 88, paddingTop: 12, textAlignVertical: 'top', fontFamily: fonts.text }]} />
          </View>
        ) : null}
        {error ? <FormMessage text={error} /> : null}
      </ScrollView>
      <SafeAreaView edges={['bottom']} style={styles.bar}>
        <View style={{ flex: 1 }}>
          <Text style={[text.caption, { color: colors.muted }]}>{slot ? 'Selected' : 'No time selected'}</Text>
          <Text style={[text.cardTitle, { color: colors.navy }]} numberOfLines={1}>
            {slot ? formatDateTime(slot.startAt, zone, { weekday: true, zone: false }) : 'Choose a time'}
          </Text>
        </View>
        <Button title="Review" icon="arrow-right" disabled={!slot} onPress={() => setStep('review')} style={{ paddingHorizontal: 22 }} />
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  slot: { width: '31.5%', minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface },
  panel: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.line, ...shadow.md },
});
