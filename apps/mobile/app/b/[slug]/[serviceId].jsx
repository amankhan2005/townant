import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCatalog } from '../../../src/catalog.jsx';
import { formatPrice } from '../../../src/format.js';
import { accents, colors, radius, shadow, text } from '../../../src/theme.js';
import { Button, CategoryBadge, DetailSkeleton, Empty, ErrorView, Icon, Rating, Text, useApi } from '../../../src/ui.jsx';

// One service of a business: what it is, how long it takes, the business's price, and how booking
// works for it (instant confirmation, or a request the business confirms).
export default function ServiceScreen() {
  const { slug, serviceId } = useLocalSearchParams();
  const router = useRouter();
  const catalog = useCatalog();
  const profile = useApi(`/catalog/companies/${slug}`);
  const services = useApi(`/catalog/companies/${slug}/services`);

  const failed = (profile.error && !profile.data) || (services.error && !services.data);
  if (failed) {
    return (
      <View style={{ padding: 16 }}>
        <ErrorView
          error={profile.error ?? services.error}
          onRetry={() => {
            profile.reload();
            services.reload();
          }}
        />
      </View>
    );
  }
  if (!profile.data || !services.data) return <DetailSkeleton label="Loading service" />;
  const c = profile.data;
  const svc = services.data.find((x) => x.id === serviceId);
  if (!svc) {
    return (
      <View style={{ padding: 16 }}>
        <Empty icon="briefcase" title="Service not available" body="The business may have changed or removed it." action={<Button title={`See ${c.name}`} onPress={() => router.replace(`/b/${c.slug}`)} />} />
      </View>
    );
  }
  const look = catalog.look(catalog.byId.get(svc.categoryId) ?? c.category);
  const request = svc.bookingMode === 'request';
  const price = formatPrice(svc.price);
  const book = () => router.push({ pathname: `/book/${c.slug}`, params: { serviceId: svc.id, title: svc.title, tz: c.timezone, company: c.name, duration: String(svc.durationMinutes), mode: svc.bookingMode, price: price ?? '' } });
  const facts = [
    ['clock', 'Duration', `${svc.durationMinutes} minutes`, accents.blue],
    ['tag', 'Price', price ?? 'Not listed', accents.amber],
    [request ? 'send' : 'zap', 'Booking', request ? 'Business confirms' : 'Instant', request ? accents.orange : accents.teal],
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.cloud }}>
      <Stack.Screen options={{ title: svc.title }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 16 }}>
        <View style={[styles.card, { flexDirection: 'row', gap: 14, alignItems: 'center' }]}>
          <CategoryBadge look={look} size={56} radius={18} />
          <View style={{ flex: 1 }}>
            <Text style={[text.title, { color: colors.navy }]} accessibilityRole="header">
              {svc.title}
            </Text>
            {price ? <Text style={[text.bodyStrong, { color: colors.teal700 }]}>{price}</Text> : null}
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          {facts.map(([icon, label, value, accent]) => (
            <View key={label} style={[styles.card, { flex: 1, padding: 12, gap: 6 }]} accessible accessibilityLabel={`${label}: ${value}`}>
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: accent.bg, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={icon} size={16} color={accent.fg} />
              </View>
              <Text style={[text.caption, { color: colors.muted }]}>{label}</Text>
              <Text style={[text.label, { color: colors.navy }]}>{value}</Text>
            </View>
          ))}
        </View>

        {svc.description ? (
          <View style={[styles.card, { gap: 6 }]}>
            <Text style={[text.cardTitle, { color: colors.navy }]}>About this service</Text>
            <Text style={[text.body, { color: colors.slate }]}>{svc.description}</Text>
            {svc.price?.note ? <Text style={[text.secondary, { color: colors.muted, fontSize: 14 }]}>{svc.price.note}</Text> : null}
          </View>
        ) : null}

        <View style={[styles.card, { gap: 10 }]}>
          <Text style={[text.cardTitle, { color: colors.navy }]}>How booking works</Text>
          {(request
            ? ['Pick a day and one of the business’s open times.', 'Send your request — the business reviews and confirms it.', 'You’ll get an update in Bookings and Notifications.']
            : ['Pick a day and one of the business’s open times.', 'Confirm — the time is reserved for you straight away.', 'Manage it any time from Bookings.']
          ).map((step, i) => (
            <View key={step} style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.teal50, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={[text.caption, { color: colors.teal700, fontWeight: '700' }]}>{i + 1}</Text>
              </View>
              <Text style={[text.body, { color: colors.slate, flex: 1 }]}>{step}</Text>
            </View>
          ))}
          {c.bookingPolicy?.cancellationCutoffHours ? <Text style={[text.secondary, { color: colors.muted, fontSize: 14 }]}>Cancel online up to {c.bookingPolicy.cancellationCutoffHours} hours before the appointment.</Text> : null}
          <Text style={[text.secondary, { color: colors.muted, fontSize: 14 }]}>No payment through TownAnt — you pay the business directly.</Text>
        </View>

        <Pressable onPress={() => router.push(`/b/${c.slug}`)} accessibilityRole="link" accessibilityLabel={`Offered by ${c.name}. View business`} style={({ pressed }) => [styles.card, { flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.85 : 1 }]}>
          <CategoryBadge look={catalog.look(c.category)} size={44} radius={14} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[text.caption, { color: colors.muted }]}>Offered by</Text>
            <Text style={[text.cardTitle, { color: colors.navy }]}>{c.name}</Text>
            <Rating rating={c.rating} isNew={c.isNew} />
          </View>
          <Icon name="chevron-right" color={colors.subtle} />
        </Pressable>
      </ScrollView>
      <SafeAreaView edges={['bottom']} style={styles.bar}>
        <Button title={request ? 'Request a time' : 'Choose a time'} icon="calendar" onPress={book} style={{ flex: 1 }} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.line, padding: 16 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.line, ...shadow.md },
});
