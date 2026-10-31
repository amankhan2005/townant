import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

// The API base URL is public configuration, never a secret. All authority stays on the server.
// EXPO_PUBLIC_API_URL (or extra.apiUrl) wins. Without it, a development build assumes the API runs
// on the computer serving the bundle and uses that computer's address from Expo — "localhost" on
// a phone or emulator is the device itself, so it would never reach the API.
export function apiOrigin(configured = process.env.EXPO_PUBLIC_API_URL ?? Constants.expoConfig?.extra?.apiUrl, dev = __DEV__, hostUri = Constants.expoConfig?.hostUri) {
  if (configured) return configured.replace(/\/+$/, '');
  const devHost = dev && hostUri ? hostUri.split(':')[0] : null;
  return devHost ? `http://${devHost}:4000` : 'http://localhost:4000';
}
const BASE = `${apiOrigin()}/api/v1`;
const TOKEN_KEY = 'townant.session';

let token = null;

// Session tokens live in the platform keychain/keystore, not in plain AsyncStorage.
export async function loadToken() {
  token = await SecureStore.getItemAsync(TOKEN_KEY);
  return token;
}
export async function saveToken(value) {
  token = value;
  if (value) await SecureStore.setItemAsync(TOKEN_KEY, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? 'Something went wrong. Please try again.');
    this.status = status;
    this.code = body?.error?.code ?? (status === 0 ? 'NETWORK_ERROR' : 'UNKNOWN');
    this.details = body?.error?.details;
  }
}

export async function api(path, { method = 'GET', body, query, headers = {} } = {}) {
  const qs = query
    ? `?${Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')}`
    : '';
  const h = { Accept: 'application/json', ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${BASE}${path}${qs}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, { error: { message: "You're offline. Check your connection and try again." } });
  }
  if (res.status === 204) return { data: null };
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) await saveToken(null);
    throw new ApiError(res.status, json);
  }
  return json;
}

export const newIdempotencyKey = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
