import { KEYS, readJson, writeJson } from './storage.js';

// A booking a visitor has filled in and confirmed, waiting for them to sign in. It is kept in device
// storage so it survives the sign-in step (and an app restart), and it carries the idempotency key
// that will be sent with the booking, so however many times submission is retried the API creates
// at most one booking. Nothing is sent to the API until the customer is signed in.
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

export async function loadPendingBooking() {
  const p = await readJson(KEYS.pendingBooking);
  if (!p) return null;
  if (!p.savedAt || Date.now() - p.savedAt > MAX_AGE_MS || new Date(p.slot?.startAt).getTime() < Date.now()) {
    await writeJson(KEYS.pendingBooking, null);
    return null;
  }
  return p;
}

export const savePendingBooking = (p) => writeJson(KEYS.pendingBooking, { ...p, savedAt: Date.now() });
export const clearPendingBooking = () => writeJson(KEYS.pendingBooking, null);
