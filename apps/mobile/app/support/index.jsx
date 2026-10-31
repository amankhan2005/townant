import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useAuth } from '../../src/auth.jsx';
import { SignInPrompt } from '../../src/SignInPrompt.jsx';
import { SUPPORT_CATEGORY_LABELS, SUPPORT_STATUS } from '../../src/support.js';
import { colors } from '../../src/theme.js';
import { Button, Empty, ErrorView, Icon, InlineError, Muted, RowSkeleton, s, Text, TonePill, useApi } from '../../src/ui.jsx';

// Customer support requests to the TownAnt team (separate from messages with businesses).
export default function SupportList() {
  const { user } = useAuth();
  const router = useRouter();
  const list = useApi(user ? '/support/tickets' : null, { limit: 50 });
  const { reload } = list;
  useFocusEffect(
    useCallback(() => {
      if (user) reload();
    }, [user, reload]),
  );
  if (!user) return <SignInPrompt icon="inbox" title="Your support requests" text="Sign in to see your requests to TownAnt and our replies." reason="support" />;
  return (
    <FlatList
      contentContainerStyle={s.screen}
      data={list.data ?? []}
      keyExtractor={(t) => t.id}
      refreshControl={<RefreshControl refreshing={list.loading && Boolean(list.data)} onRefresh={list.reload} tintColor={colors.teal} />}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <Muted>Questions about your account, a booking or a business? Send a request and follow the replies here.</Muted>
          <Button title="New request" icon="plus" onPress={() => router.push('/support/new')} />
          {list.error && list.data ? <InlineError error={list.error} onRetry={list.reload} /> : null}
        </View>
      }
      ListEmptyComponent={
        !list.data && !list.error ? (
          <RowSkeleton count={3} label="Loading support requests" />
        ) : list.error && !list.data ? (
          <ErrorView error={list.error} onRetry={list.reload} />
        ) : (
          <Empty icon="life-buoy" title="No requests yet" body="If something isn’t right, tell us and we’ll reply here." />
        )
      }
      renderItem={({ item: t }) => {
        const [label, tone] = SUPPORT_STATUS[t.status] ?? [t.status, 'slate'];
        return (
          <Pressable accessibilityRole="link" accessibilityLabel={`${t.subject}, ${label}`} onPress={() => router.push(`/support/${t.id}`)} style={({ pressed }) => [s.card, { flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.85 : 1 }]}>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {t.unread ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.teal }} /> : null}
                <Text style={[s.h2, { flex: 1 }]} numberOfLines={1}>
                  {t.subject}
                </Text>
              </View>
              <Muted style={{ fontSize: 13 }} numberOfLines={1}>
                {t.reference} · {SUPPORT_CATEGORY_LABELS[t.category] ?? t.category}
              </Muted>
              <TonePill label={label} tone={tone} />
            </View>
            <Icon name="chevron-right" color={colors.subtle} />
          </Pressable>
        );
      }}
    />
  );
}
