import { requestJson } from './http.js';

export function createExpoPush({ accessToken } = {}) {
  return {
    name: 'expo-push',
    // Returns one ticket per message: { ok, id } or { ok: false, unregistered, error }.
    async send(messages) {
      const json = await requestJson('expo-push', 'https://exp.host/--/api/v2/push/send', {
        headers: { Accept: 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: messages.map((m) => ({ to: m.to, title: m.title, body: m.body, data: m.data, sound: 'default' })),
      });
      return (json.data ?? []).map((t) =>
        t.status === 'ok'
          ? { ok: true, id: t.id }
          : { ok: false, unregistered: t.details?.error === 'DeviceNotRegistered', error: t.details?.error ?? 'error' },
      );
    },
  };
}
