import { useCallback, useState, useSyncExternalStore } from 'react';

const KEY = 'townant.location';

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? null;
  } catch {
    return null;
  }
}

// One shared store so every search bar, homepage row and the assistant see the same location
// the moment it changes (and other tabs follow via the storage event).
let current = typeof window === 'undefined' ? null : read();
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    current = read();
    emit();
  });
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function store(next) {
  current = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: keep in memory only */
  }
  emit();
}

// The customer's chosen search area. Manual entry always works; device location is only
// requested when the user asks for it, and precise coordinates stay in this browser.
export function useSearchLocation() {
  const location = useSyncExternalStore(subscribe, () => current, () => null);
  const [status, setStatus] = useState('idle');

  const setLocation = useCallback((next) => store(next), []);

  // `onLocated` lets the caller close its picker once the position is known.
  const locateDevice = useCallback((onLocated) => {
    if (!('geolocation' in navigator)) {
      setStatus('unsupported');
      return;
    }
    setStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        store({ mode: 'device', lat: Number(pos.coords.latitude.toFixed(4)), lng: Number(pos.coords.longitude.toFixed(4)), label: 'Near me' });
        setStatus('idle');
        if (typeof onLocated === 'function') onLocated();
      },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  }, []);

  return { location, setLocation, locateDevice, status };
}

export function locationQuery(location) {
  if (!location) return {};
  if (location.mode === 'device') return { lat: location.lat, lng: location.lng, radiusKm: location.radiusKm ?? 25 };
  return { city: location.city || undefined, region: location.region || undefined, postalCode: location.postalCode || undefined, country: location.country || undefined };
}

// Query parameters without empty values, ready for the API or a URL.
export const cleanQuery = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

export const locationLabel = (l) => (!l ? 'Anywhere' : l.mode === 'device' ? 'Near me' : [l.postalCode, l.city, l.region, l.country].filter(Boolean).join(', ') || 'Anywhere');
