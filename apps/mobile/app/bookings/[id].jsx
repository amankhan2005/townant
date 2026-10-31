import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { api } from '../../src/api.js';
import { accents, colors, radius, text } from '../../src/theme.js';
import { Button, DetailSkeleton, ErrorView, formatDateTime, Icon, InlineError, Muted, StatusPill, Text, useApi } from '../../src/ui.jsx';

export default function BookingScreen() {
  const { id, created } = useLocalSearchParams();
  const router = useRouter();
  const booking = useApi(`/bookings/${id}`);
  if (booking.error && !booking.data) {
    return (
      <View style={{ padding: 16 }}>
        <ErrorView error={booking.error} onRetry={booking.reload} />
      </View>
    );
  }
  if (!booking.data) return <DetailSkeleton label="Loading booking" />;
  const b = booking.data;
  // The business may since have been removed from TownAnt; the booking record remains.
  const company = b.company ?? { name: 'Business no longer on TownAnt' };

  const cancel = () =>
    Alert.alert('Cancel this booking?', 'The business will be notified and the time released.', [
      { text: 'Keep booking', style: 'cancel' },
      {
        text: 'Cancel booking',
        style: 'destructive',
        onPress: async () => {
          try {
            const { data } = await api(`/bookings/${b.id}/cancel`, { method: 'POST', body: {} });
            booking.setData(data);
          } catch (err) {
            Alert.alert("Couldn't cancel", err.message);
          }
        },
      },
    ]);

  const address = company.address?.line1 ? [company.address.line1, company.address.city].filter(Boolean).join(', ') : null;
  const rows = [
    ['calendar', formatDateTime(b.startAt, b.timezone), `${b.service.durationMinutes} minutes`, accents.teal],
    address && ['map-pin', address, null, accents.blue],
    b.customerNote && ['edit-3', 'Your note', b.customerNote, accents.amber],
  ].filter(Boolean);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 14 }}>
      {booking.error ? <InlineError error={booking.error} onRetry={booking.reload} /> : null}
      {created ? (
        <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: colors.teal50, borderRadius: 16, padding: 14 }}>
          <Icon name="check-circle" size={22} color={colors.teal700} />
          <View style={{ flex: 1 }}>
            <Text style={[text.cardTitle, { color: colors.teal700 }]}>{b.status === 'requested' ? 'Request sent' : 'Booking confirmed'}</Text>
            <Text style={[text.secondary, { color: colors.teal700 }]}>{b.status === 'requested' ? 'We’ll notify you when the business replies.' : 'It’s in your Bookings. We’ll remind you before your visit.'}</Text>
          </View>
        </View>
      ) : null}
      <View style={styles.panel}>
        <View style={{ padding: 18, gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[text.caption, { color: colors.muted }]}>Booking {b.reference}</Text>
            <StatusPill status={b.status} />
          </View>
          <Text style={[text.title, { color: colors.navy }]} accessibilityRole="header">
            {b.service.title}
          </Text>
          <Text style={[text.bodyStrong, { color: colors.teal700 }]} onPress={company.slug ? () => router.push(`/b/${company.slug}`) : undefined} accessibilityRole={company.slug ? 'link' : undefined}>
            {company.name}
          </Text>
          {b.status === 'requested' ? <Muted>Waiting for the business to confirm. We’ll notify you.</Muted> : null}
        </View>
        {rows.map(([icon, title, body, accent]) => (
          <View key={icon} style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 18, paddingVertical: 12, borderTopWidth: 1, borderColor: colors.line }}>
            <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: accent.bg, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={icon} size={16} color={accent.fg} />
            </View>
            <View style={{ flex: 1, gap: 2, paddingTop: 6 }}>
              <Text style={[text.bodyStrong, { color: colors.navy }]}>{title}</Text>
              {body ? <Text style={[text.secondary, { color: colors.muted, fontSize: 14 }]}>{body}</Text> : null}
            </View>
          </View>
        ))}
      </View>
      {b.actions.includes('cancel_customer') ? <Button title="Cancel booking" icon="x-circle" variant="danger" onPress={cancel} /> : null}
      {['requested', 'confirmed'].includes(b.status) && !b.actions.includes('cancel_customer') ? <Muted>Online cancellation has closed. Contact the business if plans change.</Muted> : null}
      {company.phone ? <Button title={`Call ${company.name}`} icon="phone" variant="secondary" onPress={() => Linking.openURL(`tel:${company.phone}`)} /> : null}
      <Muted style={{ fontSize: 12, textAlign: 'center' }}>To reschedule, message the business, or leave a review, use the TownAnt website. No payment through TownAnt — you pay the business directly.</Muted>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
});
