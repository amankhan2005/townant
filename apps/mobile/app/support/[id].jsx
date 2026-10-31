import { formatDateTime } from '@townant/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { api } from '../../src/api.js';
import { SUPPORT_CATEGORY_LABELS, SUPPORT_STATUS } from '../../src/support.js';
import { colors } from '../../src/theme.js';
import { Button, Card, DetailSkeleton, Empty, ErrorView, Field, FormMessage, Muted, s, Text, TonePill, useApi } from '../../src/ui.jsx';

export default function SupportTicket() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const ticket = useApi(`/support/tickets/${id}`);
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);

  if (ticket.error && !ticket.data) {
    return ticket.error.status === 404 ? <Empty icon="life-buoy" title="Request not found" action={<Button size="sm" variant="secondary" title="All requests" onPress={() => router.replace('/support')} />} /> : <ErrorView error={ticket.error} onRetry={ticket.reload} />;
  }
  if (!ticket.data) return <DetailSkeleton label="Loading request" />;
  const t = ticket.data;
  const [label, tone] = SUPPORT_STATUS[t.status] ?? [t.status, 'slate'];

  const run = async (key, fn) => {
    setPending(key);
    setError(null);
    try {
      await fn();
      await ticket.reload();
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setPending(null);
    }
  };
  const reply = async () => {
    if (await run('reply', () => api(`/support/tickets/${id}/messages`, { method: 'POST', body: { body: body.trim() } }))) setBody('');
  };
  const setStatus = (action) => run(action, () => api(`/support/tickets/${id}/status`, { method: 'POST', body: { action } }));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: 6 }}>
          <Muted style={{ fontSize: 12 }}>
            {t.reference} · {SUPPORT_CATEGORY_LABELS[t.category] ?? t.category}
          </Muted>
          <Text style={s.h1} accessibilityRole="header">
            {t.subject}
          </Text>
          <TonePill label={label} tone={tone} />
        </Card>
        {t.messages.map((m) =>
          m.authorType === 'system' ? (
            <Muted key={m.id} style={{ textAlign: 'center', fontSize: 12 }}>
              {m.body}
            </Muted>
          ) : (
            <View key={m.id} style={[s.card, m.authorType === 'requester' ? { backgroundColor: colors.navy, borderColor: colors.navy, marginLeft: 32 } : { marginRight: 32 }]}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: m.authorType === 'requester' ? 'rgba(255,255,255,0.7)' : colors.teal700 }}>
                {m.authorType === 'requester' ? 'You' : 'TownAnt support'} · {formatDateTime(m.createdAt)}
              </Text>
              <Text style={{ marginTop: 6, fontSize: 15, lineHeight: 21, color: m.authorType === 'requester' ? colors.surface : colors.slate }}>{m.body}</Text>
            </View>
          ),
        )}
        {t.status === 'closed' ? (
          <Card style={{ gap: 8 }}>
            <Muted>This request is closed. If you still need help, start a new request.</Muted>
            <Button title="New request" variant="secondary" onPress={() => router.replace('/support/new')} />
          </Card>
        ) : (
          <Card style={{ gap: 10 }}>
            <Field label="Your reply" value={body} onChangeText={setBody} maxLength={4000} multiline textAlignVertical="top" style={[s.input, { minHeight: 100, paddingTop: 12 }]} />
            {error ? <FormMessage text={error.message} /> : null}
            <Button title="Send reply" pending={pending === 'reply'} disabled={body.trim().length < 2} onPress={reply} />
            {t.status === 'resolved' ? <Button title="Reopen request" variant="secondary" pending={pending === 'reopen'} onPress={() => setStatus('reopen')} /> : <Button title="My issue is resolved" variant="ghost" pending={pending === 'resolve'} onPress={() => setStatus('resolve')} />}
          </Card>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
