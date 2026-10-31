import { isoDateInZone, monthDayOfIso } from '@townant/shared';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useAuth } from '../../src/auth.jsx';
import { SignInPrompt } from '../../src/SignInPrompt.jsx';
import { colors, radius, text } from '../../src/theme.js';
import { Button, Empty, ErrorView, formatDateTime, Icon, InlineError, RowSkeleton, s, StatusPill, Text, useApi } from '../../src/ui.jsx';

// Calendar badge for the appointment's day in the business's time zone.
const parts = (iso, timeZone) => monthDayOfIso(isoDateInZone(iso, timeZone));

export default function Bookings() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams();
  const [when, setWhen] = useState(params.when === 'past' ? 'past' : 'upcoming');
  // Profile's "My bookings" / "Booking history" links choose the tab.
  const [seen, setSeen] = useState(params.when);
  if (params.when !== seen) {
    setSeen(params.when);
    if (params.when === 'past' || params.when === 'upcoming') setWhen(params.when);
  }
  const list = useApi(user ? '/bookings' : null, { when, limit: 30 }, [user?.id]);
  const { reload } = list;
  useFocusEffect(
    useCallback(() => {
      if (user) reload();
    }, [user, reload]),
  );
  if (!user) return <SignInPrompt icon="calendar" title="Your bookings live here" text="Sign in to see upcoming appointments, booking requests and past visits." reason="bookings" points={['Get confirmations and reminders', 'Cancel online within the business’s policy']} />;
  return (
    <FlatList
      data={list.data ?? []}
      keyExtractor={(b) => b.id}
      contentContainerStyle={s.screen}
      refreshControl={<RefreshControl refreshing={list.loading && Boolean(list.data)} onRefresh={list.reload} tintColor={colors.teal} colors={[colors.teal]} />}
      ListHeaderComponent={
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', backgroundColor: colors.line, borderRadius: 14, padding: 4 }} accessibilityRole="tablist">
            {[
              ['upcoming', 'Upcoming'],
              ['past', 'Past'],
            ].map(([w, label]) => {
              const on = when === w;
              return (
                <Pressable key={w} onPress={() => setWhen(w)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={{ flex: 1, minHeight: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? colors.white : 'transparent' }}>
                  <Text style={[text.label, { color: on ? colors.navy : colors.muted }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          {list.error && list.data ? <InlineError error={list.error} onRetry={list.reload} /> : null}
        </View>
      }
      ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
      renderItem={({ item: b }) => {
        const d = parts(b.startAt, b.timezone);
        return (
          <Pressable onPress={() => router.push(`/bookings/${b.id}`)} accessibilityRole="link" accessibilityLabel={`${b.service.title} with ${b.company?.name}, ${formatDateTime(b.startAt, b.timezone)}`} style={({ pressed }) => [s.card, { flexDirection: 'row', gap: 14, alignItems: 'center', opacity: pressed ? 0.9 : 1 }]}>
            <View style={{ width: 58, borderRadius: 14, backgroundColor: when === 'upcoming' ? colors.teal50 : colors.cloud, alignItems: 'center', paddingVertical: 8 }}>
              <Text style={[text.overline, { color: when === 'upcoming' ? colors.teal700 : colors.muted }]}>{d.month}</Text>
              <Text style={[text.title, { color: colors.navy, lineHeight: 28 }]}>{d.day}</Text>
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[text.cardTitle, { color: colors.navy }]} numberOfLines={1}>
                {b.service.title}
              </Text>
              <Text style={[text.secondary, { color: colors.muted }]} numberOfLines={1}>
                {b.company?.name}
              </Text>
              <Text style={[text.secondary, { color: colors.slate }]}>{formatDateTime(b.startAt, b.timezone)}</Text>
              <StatusPill status={b.status} />
            </View>
            <Icon name="chevron-right" color={colors.subtle} />
          </Pressable>
        );
      }}
      ListEmptyComponent={
        !list.data && !list.error ? (
          <RowSkeleton count={3} label="Loading bookings" />
        ) : list.error && !list.data ? (
          <ErrorView error={list.error} onRetry={list.reload} />
        ) : (
          <View style={[s.card, { borderRadius: radius }]}>
            <Empty icon="calendar" title={when === 'upcoming' ? 'No upcoming bookings' : 'No past bookings'} body={when === 'upcoming' ? 'Find a service and book a time — it will appear here.' : 'Appointments you’ve had will appear here.'} action={when === 'upcoming' ? <Button title="Find a service" icon="search" onPress={() => router.navigate('/explore')} /> : null} />
          </View>
        )
      }
    />
  );
}
