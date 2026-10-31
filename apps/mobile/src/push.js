import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api.js';

let registered = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

// Asks for permission in context (after the customer books or turns on push) and registers
// the Expo push token with the API. Delivery is best-effort; the in-app list is the record.
export async function registerForPush() {
  if (!Device.isDevice) return { ok: false, reason: 'Push notifications need a physical device.' };
  if (Platform.OS === 'android') {
    // AndroidImportance is re-exported by expo-notifications via `export *`, which import/namespace cannot follow.
    // eslint-disable-next-line import/namespace
    await Notifications.setNotificationChannelAsync('default', { name: 'Booking updates', importance: Notifications.AndroidImportance.DEFAULT });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== 'granted') return { ok: false, reason: 'Notifications are turned off in Settings.' };
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  await api('/notifications/devices', { method: 'POST', body: { token: data, platform: Platform.OS === 'ios' ? 'ios' : 'android' } });
  registered = data;
  return { ok: true };
}

export async function unregisterPush() {
  if (!registered) return;
  await api('/notifications/devices', { method: 'DELETE', body: { token: registered } });
  registered = null;
}

// Notification taps carry an app-relative path; screens re-check access via the API.
export function linkFromNotification(response) {
  const link = response?.notification?.request?.content?.data?.link;
  return typeof link === 'string' && link.startsWith('/') && !link.startsWith('//') ? link : null;
}
