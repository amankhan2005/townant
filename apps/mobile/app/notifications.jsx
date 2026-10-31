import { useRouter } from 'expo-router';
import { FlatList, Pressable, View } from 'react-native';
import { api } from '../src/api.js';
import { useAuth } from '../src/auth.jsx';
import { SignInPrompt } from '../src/SignInPrompt.jsx';
import { colors } from '../src/theme.js';
import { formatRelative } from '@townant/shared';
import { Button, Card, Empty, ErrorView, Muted, RowSkeleton, s, Text, useApi } from '../src/ui.jsx';

export default function Notifications() {
  const { user } = useAuth();
  const router = useRouter();
  const list = useApi(user ? '/notifications' : null, { limit: 40 }, [user?.id]);
  if (!user) return <SignInPrompt icon="bell" title="Booking updates" text="Sign in to see confirmations, reminders and replies about your bookings." />;
  const open = async (n) => {
    if (!n.read) api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
    // Only in-app bookings links have a native screen; others are informational here.
    const match = n.link?.match(/^\/bookings\/([a-f0-9]{24})$/);
    if (match) router.push(`/bookings/${match[1]}`);
  };
  return (
    <FlatList
      data={list.data ?? []}
      keyExtractor={(n) => n.id}
      contentContainerStyle={s.screen}
      ListHeaderComponent={list.meta?.unread ? <Button title="Mark all as read" variant="secondary" onPress={async () => { await api('/notifications/read-all', { method: 'POST' }); list.reload(); }} /> : null}
      ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
      renderItem={({ item: n }) => (
        <Pressable onPress={() => open(n)} accessibilityRole="button">
          <Card style={{ gap: 4, borderColor: n.read ? colors.line : colors.teal, backgroundColor: n.read ? colors.white : colors.tealSoft }}>
            <Text style={s.h2}>{n.title}</Text>
            {n.body ? <Text style={{ color: colors.slate }}>{n.body}</Text> : null}
            <Muted style={{ fontSize: 12 }}>{formatRelative(n.createdAt)}</Muted>
          </Card>
        </Pressable>
      )}
      ListEmptyComponent={!list.data && !list.error ? <RowSkeleton count={4} label="Loading notifications" /> : list.error && !list.data ? <ErrorView error={list.error} onRetry={list.reload} /> : <Empty icon="bell" title="You're all caught up" body="Booking updates and messages will appear here." />}
    />
  );
}
