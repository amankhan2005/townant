import * as SecureStore from 'expo-secure-store';

// Small JSON values kept on the device in the platform keystore (the same store as the session
// token): the chosen location, favorites saved on this device, and a booking waiting for sign-in.
// Values are kept small (ids, not copies of business data).
export const KEYS = {
  location: 'townant.location',
  favorites: 'townant.favorites',
  pendingBooking: 'townant.pendingBooking',
};

export async function readJson(key, fallback = null) {
  try {
    const raw = await SecureStore.getItemAsync(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export async function writeJson(key, value) {
  try {
    if (value === null || value === undefined) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, JSON.stringify(value));
  } catch {
    // Storage is a convenience; the app keeps working for this session without it.
  }
}
