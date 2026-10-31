import { countryOptions } from '@townant/shared';
import * as Location from 'expo-location';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KEYS, readJson, writeJson } from './storage.js';
import { colors, text } from './theme.js';
import { Button, Field, Icon, Muted, s, SelectSheet, Skeleton, Text, useApi } from './ui.jsx';

const COUNTRIES = countryOptions();
const LocationContext = createContext(null);

const placeLabel = (w) => (!w ? null : w.mode === 'device' ? w.label || 'Near you' : [w.city, w.region].filter(Boolean).join(', ') || w.postalCode || null);

// The customer's search location, shared by every screen and kept on the device between launches.
// It is turned into the API's own location filters (catalog search): coordinates match businesses
// within 25 km plus those whose service radius reaches the customer; a city matches business
// addresses; a ZIP code also matches businesses that list it in their service area.
export function LocationProvider({ children }) {
  const [where, setWhereState] = useState(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    readJson(KEYS.location).then((saved) => {
      if (saved) setWhereState(saved);
      setReady(true);
    });
  }, []);

  const setWhere = useCallback((w) => {
    setWhereState(w);
    writeJson(KEYS.location, w);
  }, []);

  const useDevice = useCallback(async () => {
    setMessage(null);
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setMessage('Location access is off. Choose a city or enter a ZIP code instead.');
      return;
    }
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lat = Number(pos.coords.latitude.toFixed(4));
      const lng = Number(pos.coords.longitude.toFixed(4));
      let label = null;
      try {
        const [place] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        label = [place?.city || place?.subregion, place?.region].filter(Boolean).join(', ') || null;
      } catch {
        // The label is cosmetic; search uses the coordinates.
      }
      setWhere({ mode: 'device', lat, lng, label });
      setOpen(false);
    } catch {
      setMessage("Couldn't get your location. Choose a city or enter a ZIP code instead.");
    }
  }, [setWhere]);

  const value = useMemo(() => {
    const query = where?.mode === 'device' ? { lat: where.lat, lng: where.lng, radiusKm: 25 } : where ? { city: where.city || undefined, region: where.region || undefined, postalCode: where.postalCode || undefined, country: where.country || undefined } : {};
    return { ready, where, label: placeLabel(where) ?? 'Anywhere', city: placeLabel(where), query, openPicker: () => setOpen(true) };
  }, [where, ready]);

  return (
    <LocationContext.Provider value={value}>
      {children}
      <LocationSheet
        open={open}
        current={where}
        onClose={() => setOpen(false)}
        onDevice={useDevice}
        message={message}
        onPick={(w) => {
          setWhere(w);
          setOpen(false);
        }}
      />
    </LocationContext.Provider>
  );
}

export const useSearchLocation = () => useContext(LocationContext);

// The homepage location control: always shows which place the listings are for.
export function LocationHeader() {
  const { city, openPicker } = useSearchLocation();
  return (
    <Pressable onPress={openPicker} accessibilityRole="button" accessibilityLabel={city ? `Location: ${city}. Change location` : 'Choose your location'} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, opacity: pressed ? 0.8 : 1, alignSelf: 'flex-start', maxWidth: '100%' })}>
      <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.teal50, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="map-pin" size={18} color={colors.teal700} />
      </View>
      <View style={{ flexShrink: 1 }}>
        <Text style={[text.caption, { color: colors.muted }]}>{city ? 'Services in' : 'Location'}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={[text.cardTitle, { color: city ? colors.navy : colors.teal700, flexShrink: 1 }]} numberOfLines={1}>
            {city ?? 'Choose your location'}
          </Text>
          <Icon name="chevron-down" size={16} color={colors.navy} />
        </View>
      </View>
    </Pressable>
  );
}

// Compact trigger used inside Explore and category pages.
export function LocationChip() {
  const { label, openPicker } = useSearchLocation();
  return (
    <Pressable onPress={openPicker} accessibilityRole="button" accessibilityLabel={`Location: ${label}. Change location`} hitSlop={6} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 38, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, opacity: pressed ? 0.8 : 1 })}>
      <Icon name="map-pin" size={15} color={colors.teal} />
      <Text numberOfLines={1} style={[text.label, { color: colors.navy, maxWidth: 170 }]}>
        {label}
      </Text>
      <Icon name="chevron-down" size={15} color={colors.muted} />
    </Pressable>
  );
}

// Places that have businesses listed on TownAnt, from the public catalog (real listings only).
function usePlaces(enabled) {
  const list = useApi(enabled ? '/catalog/companies' : null, { sort: 'newest', limit: 50 });
  return useMemo(() => {
    const seen = new Map();
    for (const c of list.data ?? []) {
      const { city, region, country } = c.location ?? {};
      if (!city) continue;
      const key = `${city}|${region ?? ''}|${country ?? ''}`.toLowerCase();
      seen.set(key, { city, region, country, count: (seen.get(key)?.count ?? 0) + 1 });
    }
    return { loading: !list.data && !list.error, places: [...seen.values()].sort((a, b) => b.count - a.count || a.city.localeCompare(b.city)) };
  }, [list.data, list.error]);
}

function LocationSheet({ open, current, onClose, onDevice, onPick, message }) {
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('US');
  const [locating, setLocating] = useState(false);
  const { loading, places } = usePlaces(open);
  const device = async () => {
    setLocating(true);
    await onDevice();
    setLocating(false);
  };
  const isCurrent = (p) => current?.mode === 'place' && current.city?.toLowerCase() === p.city.toLowerCase() && (current.region ?? '') === (p.region ?? '');
  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {/* On Android the sheet is a full-screen, edge-to-edge window: keep it clear of the status and
          navigation bars, as SelectSheet does. */}
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={[s.screen, { paddingTop: 20 }]} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[text.title, { color: colors.navy }]} accessibilityRole="header">
                Choose your location
              </Text>
              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12} style={s.iconButton}>
                <Icon name="x" size={20} />
              </Pressable>
            </View>
            <Muted>TownAnt shows businesses that are based in, or serve, the place you choose.</Muted>

            <View style={{ backgroundColor: colors.teal50, borderRadius: 16, padding: 14, gap: 10 }}>
              <Button title="Use my current location" icon="navigation" variant="primary" onPress={device} pending={locating} />
              <Text style={[text.caption, { color: colors.teal700, textAlign: 'center' }]}>Your approximate location is used only to find nearby businesses.</Text>
            </View>
            {message ? <Muted>{message}</Muted> : null}

            <Text style={[text.label, { color: colors.navy, marginTop: 6 }]}>Cities with businesses on TownAnt</Text>
            {loading ? (
              <View style={{ gap: 8 }}>
                <Skeleton style={{ height: 48, borderRadius: 12 }} />
                <Skeleton style={{ height: 48, borderRadius: 12 }} />
              </View>
            ) : (
              <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 16, overflow: 'hidden' }}>
                {places.map((p, i) => {
                  const on = isCurrent(p);
                  return (
                    <Pressable key={`${p.city}-${p.region}-${p.country}`} onPress={() => onPick({ mode: 'place', city: p.city, region: p.region ?? null, country: p.country ?? null })} accessibilityRole="button" accessibilityState={{ selected: on }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 52, backgroundColor: pressed ? colors.cloud : on ? colors.teal50 : colors.surface, borderTopWidth: i ? 1 : 0, borderColor: colors.line })}>
                      <Icon name="map-pin" size={16} color={on ? colors.teal700 : colors.muted} />
                      <Text style={[text.bodyStrong, { color: colors.navy, flex: 1 }]}>{[p.city, p.region].filter(Boolean).join(', ')}</Text>
                      <Text style={[text.caption, { color: colors.muted }]}>{p.country}</Text>
                      {on ? <Icon name="check" size={16} color={colors.teal700} /> : null}
                    </Pressable>
                  );
                })}
                {!places.length ? <Muted style={{ padding: 14 }}>No cities to suggest yet — enter one below.</Muted> : null}
              </View>
            )}

            <Text style={[text.label, { color: colors.navy, marginTop: 6 }]}>Or enter a place</Text>
            <Field label="City" value={city} onChangeText={setCity} maxLength={80} textContentType="addressCity" />
            <Field label="ZIP / postal code" value={postalCode} onChangeText={setPostalCode} maxLength={12} autoCapitalize="characters" textContentType="postalCode" hint="Also finds businesses that travel to this ZIP code." />
            <SelectSheet label="Country" value={country} options={COUNTRIES} onChange={setCountry} />
            <Button title="Use this place" variant="dark" disabled={!city.trim() && !postalCode.trim()} onPress={() => onPick({ mode: 'place', city: city.trim() || null, region: null, postalCode: postalCode.trim().toUpperCase() || null, country })} />
            <Button title="Show businesses everywhere" variant="ghost" onPress={() => onPick(null)} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
