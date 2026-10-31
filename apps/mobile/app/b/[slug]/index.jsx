import { formatClock, formatIsoDate, formatRelative, todayIso, weekdayOfIso, WEEKDAYS } from '@townant/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../../src/api.js';
import { useCatalog } from '../../../src/catalog.jsx';
import { useFavorites } from '../../../src/favorites.jsx';
import { formatPrice, lowestPrice, serviceModeLabel } from '../../../src/format.js';
import { accents, colors, radius, shadow, text } from '../../../src/theme.js';
import { Button, CategoryBadge, Cover, DetailSkeleton, Empty, ErrorView, Icon, IconButton, imageUrl, LoadingGroup, Rating, Skeleton, TonePill, Text, useApi } from '../../../src/ui.jsx';

// Public business profile. Everything shown comes from the public catalog API; sections the
// business has switched off (gallery, hours, reviews, policies, contact) stay hidden.
export default function CompanyScreen() {
  const { slug } = useLocalSearchParams();
  const router = useRouter();
  const catalog = useCatalog();
  const favorites = useFavorites();
  const profile = useApi(`/catalog/companies/${slug}`);
  const services = useApi(`/catalog/companies/${slug}/services`);
  const reviews = useApi(`/catalog/companies/${slug}/reviews`, { limit: 5 });
  const scroller = useRef(null);
  const [servicesY, setServicesY] = useState(0);
  const [pastCover, setPastCover] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    api(`/catalog/companies/${slug}/view`, { method: 'POST' }).catch(() => {});
  }, [slug]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (profile.error && !profile.data) {
    return (
      <SafeAreaView style={{ flex: 1, padding: 16, gap: 12 }}>
        <IconButton icon="arrow-left" label="Back" onPress={back} />
        {profile.error.status === 404 ? <Empty icon="briefcase" title="Business not found" body="It may no longer be listed on TownAnt." action={<Button title="Explore businesses" onPress={() => router.navigate('/explore')} />} /> : <ErrorView error={profile.error} onRetry={profile.reload} />}
      </SafeAreaView>
    );
  }
  if (!profile.data) return <DetailSkeleton label="Loading business" />;

  const c = profile.data;
  const show = (section) => c.sections?.[section] !== false;
  const look = catalog.look(c.category);
  const cover = c.banner ?? c.cover;
  const saved = favorites.ids.has(c.id);
  const list = services.data ?? [];
  const from = lowestPrice(list);
  const place = [c.location?.area, c.address?.city ?? c.location?.city, c.address?.region ?? c.location?.region].filter(Boolean).join(', ');
  const book = (svc) => router.push({ pathname: `/book/${c.slug}`, params: { serviceId: svc.id, title: svc.title, tz: c.timezone, company: c.name, duration: String(svc.durationMinutes), mode: svc.bookingMode, price: formatPrice(svc.price) ?? '' } });
  const contact = show('contact') ? c.contact ?? {} : {};
  const address = [c.address?.line1, c.address?.city, [c.address?.region, c.address?.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const actions = [
    contact.phone && ['phone', 'Call', () => Linking.openURL(`tel:${contact.phone}`)],
    contact.email && ['mail', 'Email', () => Linking.openURL(`mailto:${contact.email}`)],
    contact.website && /^https?:\/\//.test(contact.website) && ['globe', 'Website', () => Linking.openURL(contact.website)],
    c.address?.line1 && c.serviceMode !== 'mobile' && ['navigation', 'Directions', () => Linking.openURL(`geo:0,0?q=${encodeURIComponent(address)}`)],
  ].filter(Boolean);

  return (
    <View style={{ flex: 1, backgroundColor: colors.cloud }}>
      <StatusBar style={cover && !pastCover ? 'light' : 'dark'} />
      <ScrollView ref={scroller} contentContainerStyle={{ paddingBottom: 120 }} scrollEventThrottle={64} onScroll={(e) => setPastCover(e.nativeEvent.contentOffset.y > 250 - insets.top - 24)}>
        <Cover image={cover} look={look} height={250} w={1080} initial>
          {cover ? <LinearGradient colors={['rgba(20,36,58,0.55)', 'rgba(20,36,58,0)']} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 110 }} /> : null}
          <SafeAreaView edges={['top']} style={{ position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 6 }}>
            <IconButton tone="glass" icon="arrow-left" label="Back" onPress={back} />
            <IconButton tone="glass" icon={saved ? 'heart' : 'heart-outline'} filled color={saved ? colors.danger : colors.navy} label={saved ? `Remove ${c.name} from saved` : `Save ${c.name}`} onPress={() => favorites.toggle(c)} />
          </SafeAreaView>
        </Cover>

        <View style={styles.sheet}>
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-end', marginTop: -52 }}>
            <View style={[styles.logo, shadow.md]}>{c.logo ? <Image source={{ uri: imageUrl(c.logo.url, 200, 200) }} style={{ width: '100%', height: '100%' }} accessibilityLabel={`${c.name} logo`} /> : <CategoryBadge look={look} size={72} radius={20} />}</View>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', flex: 1, paddingBottom: 4 }}>
              {c.verified ? <TonePill label="Verified by TownAnt" tone="teal" icon="check-circle" /> : null}
              {c.isNew ? <TonePill label="New on TownAnt" tone="navy" /> : null}
            </View>
          </View>
          <Text style={[text.title, { color: colors.navy, marginTop: 14 }]} accessibilityRole="header">
            {c.name}
          </Text>
          <Text style={[text.body, { color: colors.muted, marginTop: 2 }]}>{[c.category?.name, place].filter(Boolean).join(' · ')}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
            <Rating rating={c.rating} isNew={c.isNew} />
            {c.serviceMode && c.serviceMode !== 'fixed' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon name="truck" size={14} color={colors.teal700} />
                <Text style={[text.label, { color: colors.teal700 }]}>Comes to you</Text>
              </View>
            ) : null}
          </View>

          {actions.length ? (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
              {actions.map(([icon, label, onPress]) => (
                <Pressable key={label} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label} ${c.name}`} style={({ pressed }) => [styles.action, { opacity: pressed ? 0.8 : 1 }]}>
                  <Icon name={icon} size={19} color={colors.teal700} />
                  <Text style={[text.caption, { color: colors.navy, fontWeight: '600' }]}>{label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {c.description || c.summary ? (
            <Section title="About">
              <Text style={[text.body, { color: colors.slate }]}>{c.description || c.summary}</Text>
            </Section>
          ) : null}

          <View onLayout={(e) => setServicesY(e.nativeEvent.layout.y)}>
            <Section title="Services" subtitle={list.length ? `${list.length} available to book` : null}>
              {!services.data && !services.error ? (
                <LoadingGroup label="Loading services" style={{ gap: 10 }}>
                  <Skeleton style={{ height: 112, borderRadius: radius }} />
                  <Skeleton style={{ height: 112, borderRadius: radius }} />
                </LoadingGroup>
              ) : null}
              {services.error && !services.data ? <ErrorView error={services.error} onRetry={services.reload} title="Services didn't load" /> : null}
              {services.data?.length === 0 ? <Text style={[text.body, { color: colors.muted }]}>This business hasn’t listed bookable services yet.</Text> : null}
              {list.map((svc) => (
                <ServiceCard key={svc.id} svc={svc} onOpen={() => router.push(`/b/${c.slug}/${svc.id}`)} onBook={() => book(svc)} />
              ))}
              {list.length ? <Text style={[text.caption, { color: colors.muted }]}>Prices are for information only. Pay the business directly — TownAnt never takes payment.</Text> : null}
            </Section>
          </View>

          {show('gallery') && c.gallery?.length ? (
            <Section title="Photos">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }} style={{ marginHorizontal: -16 }}>
                <View style={{ width: 6 }} />
                {c.gallery.map((g, i) => (
                  <Image key={g.url ?? i} source={{ uri: imageUrl(g.url, 560, 420) }} style={{ width: 220, height: 165, borderRadius: 14, backgroundColor: colors.line }} accessibilityLabel={g.alt || `${c.name} photo ${i + 1}`} />
                ))}
                <View style={{ width: 6 }} />
              </ScrollView>
            </Section>
          ) : null}

          {show('hours') && c.hours ? <Hours hours={c.hours} /> : null}

          <Section title="Location & service area">
            <View style={styles.panel}>
              {address && c.serviceMode !== 'mobile' ? <InfoRow icon="map-pin" title={address} /> : place ? <InfoRow icon="map-pin" title={place} /> : null}
              <InfoRow icon={c.serviceMode === 'fixed' ? 'home' : 'truck'} title={serviceModeLabel(c.serviceMode)} />
              {c.serviceArea?.radiusKm ? <InfoRow icon="target" title={`Travels up to ${c.serviceArea.radiusKm} km`} /> : null}
              {c.serviceArea?.postalCodes?.length ? <InfoRow icon="hash" title={`Serves ZIP / postal codes ${c.serviceArea.postalCodes.join(', ')}`} /> : null}
            </View>
          </Section>

          {show('policies') ? (
            <Section title="Booking policies">
              <View style={styles.panel}>
                {c.bookingPolicy?.cancellationCutoffHours != null ? <InfoRow icon="x-circle" title={c.bookingPolicy.cancellationCutoffHours ? `Cancel online up to ${c.bookingPolicy.cancellationCutoffHours} hours before your appointment` : 'Cancel online any time before your appointment'} /> : null}
                {c.bookingPolicy?.requestExpiryHours ? <InfoRow icon="clock" title={`Booking requests the business hasn’t answered expire after ${c.bookingPolicy.requestExpiryHours} hours`} /> : null}
                {c.policies?.cancellation ? <InfoRow icon="file-text" title="Cancellation policy" body={c.policies.cancellation} /> : null}
              </View>
            </Section>
          ) : null}

          {show('reviews') ? (
            <Section title="Reviews" subtitle={c.rating?.count ? null : 'Reviews come from customers after a completed booking.'}>
              {c.rating?.count ? (
                <View style={[styles.panel, { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 }]}>
                  <Text style={[text.display, { color: colors.navy }]}>{c.rating.average.toFixed(1)}</Text>
                  <View style={{ gap: 4 }}>
                    <Stars value={c.rating.average} />
                    <Text style={[text.secondary, { color: colors.muted }]}>
                      {c.rating.count} review{c.rating.count === 1 ? '' : 's'} from completed bookings
                    </Text>
                  </View>
                </View>
              ) : (
                <Text style={[text.body, { color: colors.muted }]}>No reviews yet.</Text>
              )}
              {reviews.error && !reviews.data && c.rating?.count ? <ErrorView error={reviews.error} onRetry={reviews.reload} title="Reviews didn't load" /> : null}
              {(reviews.data ?? []).map((r) => (
                <View key={r.id} style={[styles.panel, { padding: 16, gap: 6 }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={[text.label, { color: colors.navy }]}>{r.authorName}</Text>
                    <Text style={[text.caption, { color: colors.muted }]}>{formatRelative(r.createdAt)}</Text>
                  </View>
                  <Stars value={r.rating} size={13} />
                  {r.text ? <Text style={[text.body, { color: colors.slate }]}>{r.text}</Text> : null}
                  {r.vendorReply ? (
                    <View style={{ backgroundColor: colors.cloud, borderRadius: 12, padding: 12, marginTop: 4 }}>
                      <Text style={[text.caption, { color: colors.teal700, fontWeight: '700' }]}>Reply from {c.name}</Text>
                      <Text style={[text.secondary, { color: colors.slate, marginTop: 2, fontSize: 14 }]}>{r.vendorReply.text}</Text>
                    </View>
                  ) : null}
                </View>
              ))}
            </Section>
          ) : null}

          {show('contact') && (contact.phone || contact.email || contact.website) ? (
            <Section title="Contact">
              <View style={styles.panel}>
                {contact.phone ? <InfoRow icon="phone" title={contact.phone} onPress={() => Linking.openURL(`tel:${contact.phone}`)} /> : null}
                {contact.email ? <InfoRow icon="mail" title={contact.email} onPress={() => Linking.openURL(`mailto:${contact.email}`)} /> : null}
                {contact.website ? <InfoRow icon="globe" title={contact.website} onPress={/^https?:\/\//.test(contact.website) ? () => Linking.openURL(contact.website) : undefined} /> : null}
              </View>
            </Section>
          ) : null}
        </View>
      </ScrollView>

      {/* Once the cover has scrolled away, a solid strip keeps content out from under the status bar. */}
      {pastCover ? <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: insets.top, backgroundColor: colors.cloud }} /> : null}
      {list.length ? (
        <SafeAreaView edges={['bottom']} style={styles.bar}>
          <View style={{ flex: 1 }}>
            <Text style={[text.caption, { color: colors.muted }]}>{list.length === 1 ? list[0].title : `${list.length} services`}</Text>
            <Text style={[text.cardTitle, { color: colors.navy }]} numberOfLines={1}>
              {from ?? 'See prices in services'}
            </Text>
          </View>
          <Button title={list.length === 1 ? (list[0].bookingMode === 'request' ? 'Request a time' : 'Book now') : 'Choose a service'} onPress={() => (list.length === 1 ? book(list[0]) : scroller.current?.scrollTo({ y: servicesY + 200, animated: true }))} style={{ paddingHorizontal: 22 }} />
        </SafeAreaView>
      ) : null}
    </View>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <View style={{ marginTop: 28, gap: 12 }}>
      <View>
        <Text style={[text.heading, { color: colors.navy }]} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text style={[text.secondary, { color: colors.muted, marginTop: 2 }]}>{subtitle}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function ServiceCard({ svc, onOpen, onBook }) {
  const request = svc.bookingMode === 'request';
  const price = formatPrice(svc.price);
  return (
    <Pressable onPress={onOpen} accessibilityRole="link" accessibilityLabel={`${svc.title}, ${svc.durationMinutes} minutes${price ? `, ${price}` : ''}. Details`} style={({ pressed }) => [styles.panel, { padding: 16, gap: 8, opacity: pressed ? 0.9 : 1 }]}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[text.cardTitle, { color: colors.navy }]}>{svc.title}</Text>
          {svc.description ? (
            <Text style={[text.secondary, { color: colors.muted, fontSize: 14 }]} numberOfLines={2}>
              {svc.description}
            </Text>
          ) : null}
        </View>
        {price ? <Text style={[text.cardTitle, { color: colors.navy }]}>{price}</Text> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name="clock" size={13} color={colors.muted} />
          <Text style={[text.secondary, { color: colors.muted }]}>{svc.durationMinutes} min</Text>
        </View>
        <TonePill label={request ? 'Business confirms' : 'Instant booking'} tone={request ? 'amber' : 'teal'} icon={request ? 'send' : 'zap'} />
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
        <Button title="Details" size="sm" variant="secondary" onPress={onOpen} style={{ flex: 1 }} />
        <Button title={request ? 'Request' : 'Book'} size="sm" onPress={onBook} style={{ flex: 1 }} />
      </View>
    </Pressable>
  );
}

function Hours({ hours }) {
  const today = weekdayOfIso(todayIso(hours.timezone));
  const span = (list) => (list?.length ? list.map((iv) => `${formatClock(iv.start)}–${formatClock(iv.end)}`).join(', ') : 'Closed');
  return (
    <Section title="Opening hours" subtitle={`Times in ${hours.timezone.replaceAll('_', ' ')}`}>
      <View style={[styles.panel, { paddingVertical: 6 }]}>
        {[1, 2, 3, 4, 5, 6, 0].map((d) => {
          const on = d === today;
          return (
            <View key={d} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 9, backgroundColor: on ? colors.teal50 : 'transparent' }} accessible accessibilityLabel={`${WEEKDAYS[d]}${on ? ', today' : ''}: ${span(hours.weekly[d])}`}>
              <Text style={[on ? text.bodyStrong : text.body, { color: on ? colors.teal700 : colors.slate }]}>
                {WEEKDAYS[d]}
                {on ? ' · Today' : ''}
              </Text>
              <Text style={[on ? text.bodyStrong : text.body, { color: hours.weekly[d]?.length ? (on ? colors.teal700 : colors.slate) : colors.muted }]}>{span(hours.weekly[d])}</Text>
            </View>
          );
        })}
      </View>
      {hours.exceptions?.length ? (
        <View style={[styles.panel, { padding: 14, gap: 6 }]}>
          <Text style={[text.label, { color: colors.navy }]}>Upcoming changes</Text>
          {hours.exceptions.slice(0, 4).map((e) => (
            <View key={e.date} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={[text.body, { color: colors.slate }]}>{formatIsoDate(e.date)}</Text>
              <Text style={[text.body, { color: colors.muted }]}>{e.closed ? 'Closed' : span(e.intervals)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Section>
  );
}

function InfoRow({ icon, title, body, onPress }) {
  const Row = onPress ? Pressable : View;
  return (
    <Row onPress={onPress} accessibilityRole={onPress ? 'button' : undefined} style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'flex-start' }}>
      <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: accents.teal.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={16} color={accents.teal.fg} />
      </View>
      <View style={{ flex: 1, gap: 2, paddingTop: 5 }}>
        <Text style={[text.body, { color: onPress ? colors.teal700 : colors.slate, fontWeight: onPress ? '600' : '400' }]}>{title}</Text>
        {body ? <Text style={[text.secondary, { color: colors.muted, fontSize: 14, lineHeight: 20 }]}>{body}</Text> : null}
      </View>
    </Row>
  );
}

function Stars({ value, size = 15 }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }} accessible accessibilityLabel={`${value.toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Icon key={n} filled name={value >= n - 0.25 ? 'star' : value >= n - 0.75 ? 'star-half' : 'star-outline'} size={size} color={colors.amber} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { marginTop: -24, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: colors.cloud, paddingHorizontal: 16 },
  logo: { width: 78, height: 78, borderRadius: 22, borderWidth: 3, borderColor: colors.white, backgroundColor: colors.white, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  action: { flex: 1, minHeight: 64, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', gap: 4 },
  panel: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.line, ...shadow.md },
});
