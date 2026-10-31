import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, Image, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useCatalog } from '../../src/catalog.jsx';
import { useFavorites } from '../../src/favorites.jsx';
import { LocationChip, useSearchLocation } from '../../src/location.jsx';
import { colors, radius, text } from '../../src/theme.js';
import { Button, CardListSkeleton, CategoryBadge, Chip, CompanyCard, Empty, ErrorView, imageUrl, InlineError, Text, useApi } from '../../src/ui.jsx';

// A category: its published image or colour, subcategories, and the businesses listed in it.
export default function CategoryScreen() {
  const { slug } = useLocalSearchParams();
  const router = useRouter();
  const catalog = useCatalog();
  const favorites = useFavorites();
  const { query: loc, where, openPicker } = useSearchLocation();
  const category = catalog.bySlug.get(slug);
  const parent = category?.parentId ? catalog.byId.get(category.parentId) : null;
  const kids = category ? catalog.childrenOf(category.id) : [];
  const list = useApi('/catalog/companies', { category: slug, sort: 'rating', limit: 40, ...loc });

  if (catalog.data && !category) {
    return (
      <View style={{ padding: 16 }}>
        <Empty icon="grid" title="Category not found" body="It may have been renamed or unpublished." action={<Button title="Browse categories" onPress={() => router.navigate('/explore')} />} />
      </View>
    );
  }
  if (catalog.error && !catalog.data) {
    return (
      <View style={{ padding: 16 }}>
        <ErrorView error={catalog.error} onRetry={catalog.reload} />
      </View>
    );
  }
  const look = catalog.look(category ?? { slug });
  const count = list.meta?.total ?? list.data?.length;

  const header = (
    <View style={{ gap: 16, marginBottom: 16 }}>
      <View style={[styles.hero, { backgroundColor: look.bg }]}>
        {category?.image ? (
          <>
            <Image source={{ uri: imageUrl(category.image.url, 900, 420) }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
            <LinearGradient colors={['rgba(20,36,58,0)', 'rgba(20,36,58,0.82)']} style={StyleSheet.absoluteFill} />
          </>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14 }}>
          <CategoryBadge look={{ ...look, bg: colors.white }} size={58} radius={18} />
          <View style={{ flex: 1 }}>
            {parent ? <Text style={[text.overline, { color: category?.image ? colors.teal100 : look.fg }]}>{parent.name}</Text> : null}
            <Text style={[text.title, { color: category?.image ? colors.white : colors.navy }]} accessibilityRole="header">
              {category?.name ?? ' '}
            </Text>
          </View>
        </View>
        {category?.description ? <Text style={[text.body, { color: category.image ? 'rgba(255,255,255,0.9)' : colors.slate, marginTop: 10 }]}>{category.description}</Text> : null}
      </View>

      {kids.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {kids.map((c) => (
            <Chip key={c.id} label={c.name} icon={catalog.look(c).icon} accent={look.fg} onPress={() => router.push(`/category/${c.slug}`)} />
          ))}
        </ScrollView>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <Text style={[text.label, { color: colors.muted, flex: 1 }]} accessibilityLiveRegion="polite">
          {list.data ? `${count} ${count === 1 ? 'business' : 'businesses'}` : 'Finding businesses…'}
        </Text>
        <LocationChip />
      </View>
      {list.error && list.data ? <InlineError error={list.error} onRetry={list.reload} /> : null}
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: category?.name ?? '' }} />
      <FlatList
        data={list.data ?? []}
        keyExtractor={(c) => c.id}
        ListHeaderComponent={header}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={list.loading && Boolean(list.data)} onRefresh={list.reload} tintColor={colors.teal} colors={[colors.teal]} />}
        ItemSeparatorComponent={() => <View style={{ height: 14 }} />}
        renderItem={({ item }) => <CompanyCard company={item} look={catalog.look(item.category)} favorite={favorites.ids.has(item.id)} onToggleFavorite={favorites.toggle} onPress={() => router.push(`/b/${item.slug}`)} />}
        ListEmptyComponent={
          !list.data && !list.error ? (
            <CardListSkeleton count={2} />
          ) : list.error && !list.data ? (
            <ErrorView error={list.error} onRetry={list.reload} title="Businesses didn't load" />
          ) : (
            <Empty
              icon="map"
              title={`No ${category?.name ?? 'businesses'} listed${where ? ' in this area' : ' yet'}`}
              body={where ? 'Try a wider area, or search anywhere.' : 'Check back later, or explore other categories.'}
              action={where ? <Button title="Change location" variant="secondary" icon="map-pin" onPress={openPicker} /> : <Button title="Explore categories" variant="secondary" onPress={() => router.navigate('/explore')} />}
            />
          )
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius, overflow: 'hidden', padding: 18, paddingTop: 54, minHeight: 150, justifyContent: 'flex-end' },
});
