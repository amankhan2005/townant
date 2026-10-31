import { formatDateTime } from '@townant/shared';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth.jsx';
import { useCatalog } from '../../src/catalog.jsx';
import { useFavorites } from '../../src/favorites.jsx';
import { LocationHeader, useSearchLocation } from '../../src/location.jsx';
import { initials } from '../../src/format.js';
import { loadPendingBooking } from '../../src/pendingBooking.js';
import { colors, radius, shadow, text } from '../../src/theme.js';
import { Button, CategoryTile, CompanyCard, CompanyCardSkeleton, Empty, ErrorView, FadeIn, Icon, LoadingGroup, SectionHeader, Skeleton, Text, useApi } from '../../src/ui.jsx';

const mark = require('../../assets/adaptive-icon.png');
const heroPerson = require('../../assets/hero-customer.webp');

// Home: find a service near the chosen location. Only the essentials — location, search,
// categories and real businesses for that place. Account, help and legal pages live in Profile.
export default function Home() {
  const router = useRouter();
  const { user } = useAuth();
  const catalog = useCatalog();
  const favorites = useFavorites();
  const location = useSearchLocation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [pending, setPending] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // Wait for the saved location before loading listings, so the first request is the right one.
  const ready = location.ready;
  const q = location.query;
  const popular = useApi(ready ? '/catalog/most-booked' : null, { limit: 10, ...q });
  const local = useApi(ready ? '/catalog/companies' : null, { sort: 'relevance', limit: 20, ...q });
  const topRated = useApi(ready ? '/catalog/companies' : null, { sort: 'rating', minRating: 1, limit: 10, ...q });
  const newest = useApi(ready ? '/catalog/companies' : null, { sort: 'newest', limit: 10, ...q });

  useFocusEffect(
    useCallback(() => {
      let live = true;
      loadPendingBooking().then((p) => live && setPending(p));
      return () => {
        live = false;
      };
    }, []),
  );

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([popular.reload(), local.reload(), topRated.reload(), newest.reload(), catalog.reload()]);
    setRefreshing(false);
  };

  const city = location.city;
  const near = location.where?.mode === 'device';
  const where = city ? (near ? 'near you' : `in ${city}`) : 'on TownAnt';
  const recent = (newest.data ?? []).filter((c) => c.isNew);
  const total = local.meta?.total ?? local.data?.length ?? 0;
  // "Recently added" only means something when the area also has established businesses.
  const openCompany = (c) => router.push(`/b/${c.slug}`);
  const row = { favorites, catalog, onOpen: openCompany };

  return (
    <View style={{ flex: 1, backgroundColor: colors.cloud, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.teal} colors={[colors.teal]} />}>
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }} accessible accessibilityRole="header" accessibilityLabel="TownAnt">
              <Image source={mark} style={{ width: 36, height: 36, marginLeft: -6 }} />
              <Text style={[text.heading, { fontSize: 21, color: colors.navy }]}>
                Town<Text style={{ color: colors.teal }}>Ant</Text>
              </Text>
            </View>
            {user ? (
              <Pressable onPress={() => router.navigate('/profile')} accessibilityRole="button" accessibilityLabel="Your profile" hitSlop={8} style={styles.avatar}>
                <Text style={[text.label, { color: colors.white }]}>{initials(user)}</Text>
              </Pressable>
            ) : (
              <Button title="Sign in" size="sm" variant="soft" onPress={() => router.push('/login')} />
            )}
          </View>
          <LocationHeader />
        </View>

        {pending ? (
          <Pressable onPress={() => router.push({ pathname: `/book/${pending.slug}`, params: { serviceId: pending.serviceId, title: pending.title, tz: pending.tz, company: pending.company, duration: pending.duration ?? '', mode: pending.mode ?? '', price: pending.price ?? '' } })} accessibilityRole="button" style={styles.pending}>
            <Icon name="clock" size={18} color={colors.amberText} />
            <View style={{ flex: 1 }}>
              <Text style={[text.label, { color: colors.amberText }]}>Finish your booking</Text>
              <Text style={[text.secondary, { color: colors.amberText }]} numberOfLines={1}>
                {pending.title} · {formatDateTime(pending.slot.startAt, pending.tz)}
              </Text>
            </View>
            <Icon name="chevron-right" size={18} color={colors.amberText} />
          </Pressable>
        ) : null}

        <Hero width={width} onSearch={() => router.navigate({ pathname: '/explore', params: { focus: String(Date.now()) } })} />

        <View style={{ marginTop: 24, gap: 14 }}>
          <SectionHeader title="Popular categories" action={catalog.parents.length ? 'View all' : null} onAction={() => router.navigate('/explore')} style={{ paddingHorizontal: 16 }} />
          {catalog.error && !catalog.data ? (
            <View style={{ paddingHorizontal: 16 }}>
              <ErrorView error={catalog.error} onRetry={catalog.reload} title="Categories didn't load" />
            </View>
          ) : !catalog.data ? (
            <LoadingGroup label="Loading categories" style={{ flexDirection: 'row', gap: 14, paddingHorizontal: 16 }}>
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} style={{ width: 64, height: 64, borderRadius: 20 }} />
              ))}
            </LoadingGroup>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
              {catalog.parents.slice(0, 8).map((c) => (
                <CategoryTile key={c.id} name={c.name} look={catalog.look(c)} width={78} onPress={() => router.push(`/category/${c.slug}`)} />
              ))}
            </ScrollView>
          )}
        </View>

        <Row title={`Popular ${where}`} subtitle={popular.meta ? `Most booked in the last ${popular.meta.windowDays} days` : null} list={popular} {...row} />
        <Row title={near ? 'Top-rated near you' : `Top-rated ${where}`} list={topRated} {...row} />
        {recent.length && (local.data ?? []).some((c) => !c.isNew) ? <Row title={`Recently added ${where}`} list={{ ...newest, data: recent }} {...row} /> : null}

        <View style={{ marginTop: 28, paddingHorizontal: 16, gap: 14 }}>
          <SectionHeader title="Explore local professionals" subtitle={local.data ? `${total} ${total === 1 ? 'business' : 'businesses'} ${where}` : null} />
          {local.error && !local.data ? (
            <ErrorView error={local.error} onRetry={local.reload} title="Businesses didn't load" />
          ) : !local.data ? (
            <LoadingGroup label="Loading businesses" style={{ gap: 14 }}>
              <CompanyCardSkeleton />
              <CompanyCardSkeleton />
            </LoadingGroup>
          ) : local.data.length === 0 ? (
            <View style={styles.panel}>
              <Empty
                icon="map"
                title={city ? `No businesses ${where} yet` : 'No businesses yet'}
                body={city ? 'TownAnt only lists real businesses. Try a nearby city, or look everywhere.' : 'Businesses appear here as soon as they are published.'}
                action={city ? <Button title="Change location" icon="map-pin" variant="secondary" onPress={location.openPicker} /> : null}
              />
            </View>
          ) : (
            <>
              {local.data.slice(0, 6).map((c) => (
                <CompanyCard key={c.id} company={c} look={catalog.look(c.category)} favorite={favorites.ids.has(c.id)} onToggleFavorite={favorites.toggle} onPress={() => openCompany(c)} />
              ))}
              {total > 6 ? <Button title={`See all ${total} businesses`} variant="secondary" icon="compass" onPress={() => router.navigate({ pathname: '/explore', params: { all: String(Date.now()) } })} /> : null}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// Brand-coloured hero with a cut-out photo (docs/ASSETS.md) and the search entry point. Height is
// fixed so it never takes over the screen. Separate from the Super Admin promotional banner.
function Hero({ width, onSearch }) {
  const compact = width < 380;
  const personHeight = compact ? 128 : 150;
  return (
    <View style={styles.hero}>
      <View style={[styles.glow, { right: -40, top: -50 }]} />
      <View style={[styles.glow, { right: 70, bottom: -90, width: 160, height: 160, opacity: 0.5 }]} />
      <Image source={heroPerson} resizeMode="contain" style={{ position: 'absolute', right: compact ? -34 : -18, bottom: 70, height: personHeight, width: personHeight * (760 / 626) }} accessibilityIgnoresInvertColors />
      {/* The photo's top-left is transparent, so the headline may run wider than the line below it. */}
      <View style={{ gap: 6, minHeight: personHeight - 8 }}>
        <Text style={[text.title, { color: colors.white, fontSize: compact ? 21 : 24, lineHeight: compact ? 26 : 29, maxWidth: compact ? '74%' : '72%' }]} accessibilityRole="header">
          Find local.{'\n'}
          <Text style={{ color: colors.teal100 }}>Book confidently.</Text>
        </Text>
        <Text style={[text.secondary, { color: 'rgba(255,255,255,0.9)', fontSize: 13.5, lineHeight: 19, maxWidth: compact ? '52%' : '50%' }]}>Trusted local businesses with real availability.</Text>
      </View>
      <Pressable onPress={onSearch} accessibilityRole="search" accessibilityLabel="Search services or businesses" style={({ pressed }) => [styles.search, { opacity: pressed ? 0.94 : 1 }]}>
        <Icon name="search" size={19} color={colors.teal} />
        <Text style={[text.body, { color: colors.muted, flex: 1 }]} numberOfLines={1}>
          Search services or businesses
        </Text>
      </Pressable>
    </View>
  );
}

function Row({ title, subtitle, list, favorites, catalog, onOpen }) {
  // Rows appear only with real results for the chosen place; no placeholders, no padding.
  if (!list.data?.length) return null;
  return (
    <FadeIn style={{ marginTop: 28, gap: 14 }}>
      <SectionHeader title={title} subtitle={subtitle} style={{ paddingHorizontal: 16 }} />
      <FlatList
        horizontal
        data={list.data}
        keyExtractor={(c) => c.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 6, gap: 14 }}
        renderItem={({ item }) => <CompanyCard compact company={item} look={catalog.look(item.category)} favorite={favorites.ids.has(item.id)} onToggleFavorite={favorites.toggle} onPress={() => onOpen(item)} />}
      />
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 14, gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.teal, alignItems: 'center', justifyContent: 'center' },
  pending: { marginHorizontal: 16, marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.amber50, borderWidth: 1, borderColor: '#F6D58F', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  hero: { marginHorizontal: 16, borderRadius: 24, backgroundColor: colors.teal, padding: 18, overflow: 'hidden', ...shadow.md },
  glow: { position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(255,255,255,0.08)' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.white, borderRadius: 16, paddingHorizontal: 14, minHeight: 52, marginTop: 14 },
  panel: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.line },
});
