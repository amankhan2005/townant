import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { api } from '../../src/api.js';
import { useAuth } from '../../src/auth.jsx';
import { useCatalog } from '../../src/catalog.jsx';
import { useFavorites } from '../../src/favorites.jsx';
import { colors, text } from '../../src/theme.js';
import { Button, CardListSkeleton, CompanyCard, Empty, ErrorView, Icon, s, Text, useApi } from '../../src/ui.jsx';

// Businesses saved on this device, loaded from their public profiles. One that is no longer listed
// is dropped from the device list.
function useDeviceSaved(enabled) {
  const { local, forget } = useFavorites();
  const [state, setState] = useState({ data: null, error: null });
  const key = local.map((f) => f.slug).join(',');
  const load = useCallback(async () => {
    const list = key ? key.split(',') : [];
    try {
      const rows = await Promise.all(
        list.map((slug) =>
          api(`/catalog/companies/${slug}`)
            .then((r) => r.data)
            .catch((err) => {
              if (err.status === 404) return { gone: slug };
              throw err;
            }),
        ),
      );
      rows.filter((r) => r?.gone).forEach((r) => forget(local.find((f) => f.slug === r.gone)?.id));
      setState({ data: rows.filter((r) => r && !r.gone).reverse(), error: null });
    } catch (error) {
      setState((st) => ({ ...st, error }));
    }
    // `local` is represented by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, forget]);
  useEffect(() => {
    if (enabled) Promise.resolve().then(load);
  }, [enabled, load]);
  return { ...state, reload: load, loading: false };
}

export default function Favorites() {
  const { user } = useAuth();
  const router = useRouter();
  const catalog = useCatalog();
  const favorites = useFavorites();
  const account = useApi(user ? '/favorites' : null, null, [user?.id]);
  const device = useDeviceSaved(!user && favorites.hydrated);
  const list = user ? account : device;
  const { reload } = list;
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );
  const items = (list.data ?? []).filter((c) => favorites.ids.has(c.id));

  return (
    <FlatList
      data={items}
      keyExtractor={(c) => c.id}
      contentContainerStyle={s.screen}
      refreshControl={<RefreshControl refreshing={Boolean(list.loading && list.data)} onRefresh={list.reload} tintColor={colors.teal} colors={[colors.teal]} />}
      ItemSeparatorComponent={() => <View style={{ height: 14 }} />}
      ListHeaderComponent={
        !user && items.length ? (
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: colors.teal50, borderRadius: 14, padding: 12, marginBottom: 4 }}>
            <Icon name="smartphone" size={16} color={colors.teal700} />
            <Text style={[text.secondary, { color: colors.teal700, flex: 1 }]}>Saved on this device. Sign in to keep them with your account too.</Text>
          </View>
        ) : null
      }
      renderItem={({ item }) => <CompanyCard company={item} look={catalog.look(item.category)} favorite onToggleFavorite={favorites.toggle} onPress={() => router.push(`/b/${item.slug}`)} />}
      ListEmptyComponent={
        !list.data && !list.error ? (
          <CardListSkeleton count={2} label="Loading saved businesses" />
        ) : list.error && !list.data ? (
          <ErrorView error={list.error} onRetry={list.reload} />
        ) : (
          <View style={s.card}>
            <Empty icon="heart" title="Nothing saved yet" body="Tap the heart on any business to keep it here — no account needed." action={<Button title="Explore businesses" icon="compass" onPress={() => router.navigate('/explore')} />} />
          </View>
        )
      }
    />
  );
}
