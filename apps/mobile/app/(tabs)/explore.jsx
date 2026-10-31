import { todayIso, viewerTimeZone } from '@townant/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCatalog } from '../../src/catalog.jsx';
import { useFavorites } from '../../src/favorites.jsx';
import { LocationChip, useSearchLocation } from '../../src/location.jsx';
import { colors, radius, text } from '../../src/theme.js';
import { Button, CardListSkeleton, CategoryBadge, Chip, CompanyCard, Empty, ErrorView, InlineError, SearchField, SectionHeader, Text, useApi } from '../../src/ui.jsx';

// Explore: search by service, category, business name or place, narrow with the filters the API
// supports, and browse every published category. Results always follow the chosen location.
export default function Explore() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const catalog = useCatalog();
  const favorites = useFavorites();
  const location = useSearchLocation();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState(null);
  const [sort, setSort] = useState('relevance');
  const [topOnly, setTopOnly] = useState(false);
  const [today, setToday] = useState(false);
  const input = useRef(null);

  // Home's search box focuses the field.
  useEffect(() => {
    if (!params.focus) return undefined;
    const t = setTimeout(() => input.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [params.focus]);

  // Search as the visitor types (debounced), or straight away on the keyboard's search key.
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 400);
    return () => clearTimeout(t);
  }, [q]);

  const filtered = Boolean(term || category || topOnly || today || sort !== 'relevance');
  const results = useApi(location.ready ? '/catalog/companies' : null, {
    q: term || undefined,
    category: category ?? undefined,
    sort,
    minRating: topOnly ? 4 : undefined,
    availableOn: today ? todayIso(viewerTimeZone()) : undefined,
    limit: 40,
    ...location.query,
  });
  const count = results.meta?.total ?? results.data?.length ?? 0;
  const clear = () => {
    setQ('');
    setTerm('');
    setCategory(null);
    setSort('relevance');
    setTopOnly(false);
    setToday(false);
  };

  const header = (
    <View style={{ gap: 14, marginBottom: 14 }}>
      {!filtered ? (
        <>
          <SectionHeader title="All categories" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {catalog.parents.map((p) => {
              const look = catalog.look(p);
              return (
                <Pressable key={p.id} onPress={() => router.push(`/category/${p.slug}`)} accessibilityRole="link" accessibilityLabel={p.name} style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.85 : 1 }]}>
                  <CategoryBadge look={look} size={40} radius={12} />
                  <Text style={[text.label, { color: colors.navy, flex: 1 }]} numberOfLines={2}>
                    {p.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {catalog.error && !catalog.data ? <ErrorView error={catalog.error} onRetry={catalog.reload} title="Categories didn't load" /> : null}
        </>
      ) : null}
      <SectionHeader title={filtered ? 'Results' : location.city ? `Businesses ${location.where?.mode === 'device' ? 'near you' : `in ${location.city}`}` : 'All businesses'} subtitle={results.data ? `${count} ${count === 1 ? 'business' : 'businesses'}${term ? ` for “${term}”` : ''}` : null} />
      {results.error && results.data ? <InlineError error={results.error} onRetry={results.reload} /> : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.cloud }}>
      <SafeAreaView edges={['top']} style={styles.top}>
        <Text style={[text.title, { color: colors.navy }]} accessibilityRole="header">
          Explore
        </Text>
        <SearchField inputRef={input} value={q} onChangeText={setQ} onSubmit={() => setTerm(q.trim())} placeholder="Service, business or place" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingRight: 16 }} style={{ marginRight: -16 }}>
          <LocationChip />
          <Chip label="Top rated" icon="star-outline" selected={sort === 'rating'} onPress={() => setSort(sort === 'rating' ? 'relevance' : 'rating')} />
          <Chip label="4★ & up" selected={topOnly} onPress={() => setTopOnly(!topOnly)} />
          <Chip label="Available today" icon="calendar-check-outline" selected={today} onPress={() => setToday(!today)} />
          <Chip label="Newest" icon="new-box" selected={sort === 'newest'} onPress={() => setSort(sort === 'newest' ? 'relevance' : 'newest')} />
        </ScrollView>
        {catalog.parents.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingRight: 16 }} style={{ marginRight: -16 }}>
            <Chip label="All" selected={!category} onPress={() => setCategory(null)} />
            {catalog.parents.map((p) => (
              <Chip key={p.id} label={p.name} icon={catalog.look(p).icon} accent={catalog.look(p).fg} selected={category === p.slug} onPress={() => setCategory(category === p.slug ? null : p.slug)} />
            ))}
          </ScrollView>
        ) : null}
      </SafeAreaView>

      <FlatList
        data={results.data ?? []}
        keyExtractor={(c) => c.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={results.loading && Boolean(results.data)} onRefresh={results.reload} tintColor={colors.teal} colors={[colors.teal]} />}
        ItemSeparatorComponent={() => <View style={{ height: 14 }} />}
        ListHeaderComponent={header}
        renderItem={({ item }) => <CompanyCard company={item} look={catalog.look(item.category)} favorite={favorites.ids.has(item.id)} onToggleFavorite={favorites.toggle} onPress={() => router.push(`/b/${item.slug}`)} />}
        ListEmptyComponent={
          !results.data && !results.error ? (
            <CardListSkeleton count={2} />
          ) : results.error && !results.data ? (
            <ErrorView error={results.error} onRetry={results.reload} title="Results didn't load" />
          ) : (
            <View style={styles.panel}>
              <Empty
                title="No businesses match"
                body={location.city ? `Nothing ${location.where?.mode === 'device' ? 'near you' : `in ${location.city}`} matches yet. Try other words, fewer filters or another place.` : 'Try other words or fewer filters. TownAnt only lists real businesses.'}
                action={
                  <View style={{ gap: 8 }}>
                    {filtered ? <Button title="Clear search and filters" variant="secondary" onPress={clear} /> : null}
                    <Button title="Change location" variant="ghost" icon="map-pin" onPress={location.openPicker} />
                  </View>
                }
              />
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  top: { backgroundColor: colors.cloud, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  tile: { width: '48.5%', flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.line, padding: 10, minHeight: 62 },
  panel: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.line },
});
