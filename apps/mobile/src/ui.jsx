import { BOOKING_STATUS_LABELS, BOOKING_STATUS_TONE, formatDateTime } from '@townant/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, FlatList, Image, Modal, Pressable, Text as RNText, StyleSheet, TextInput, View } from 'react-native';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from './api.js';
import { priceFromLabel } from './format.js';
import { colors, fonts, radii, radius, shadow, text } from './theme.js';

export { formatDateTime };

// Text in the brand typeface (Inter, embedded in the app). Screens import this instead of
// react-native's Text so nothing falls back to the system font. Nested text inherits from its
// parent as usual, so the base style is applied only to the outermost Text.
const InText = createContext(false);
export function Text({ style, children, ...props }) {
  const nested = useContext(InText);
  return (
    <RNText {...props} style={nested ? style : [s.text, style]}>
      {nested ? children : <InText.Provider value>{children}</InText.Provider>}
    </RNText>
  );
}

// Line icons (Feather); Ionicons for the few filled states (favorite, rating); Material Community
// Icons (`set="mci"`) for category glyphs.
export function Icon({ name, size = 18, color = colors.navy, filled, set, style }) {
  const Glyphs = set === 'mci' ? MaterialCommunityIcons : filled ? Ionicons : Feather;
  return <Glyphs name={name} size={size} color={color} style={style} accessibilityElementsHidden importantForAccessibility="no" />;
}

export function useApi(path, query, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const key = JSON.stringify([path, query, deps]);
  const loaded = useRef(null);
  const load = useCallback(async () => {
    const [p, q] = JSON.parse(key);
    if (!p) return;
    const same = loaded.current === key;
    setState((st) => ({ ...st, loading: true, error: null, ...(same ? {} : { data: null }) }));
    try {
      const res = await api(p, { query: q ?? undefined });
      loaded.current = key;
      setState({ data: res.data, meta: res.meta, error: null, loading: false });
    } catch (error) {
      // Keep earlier data for the same request so a failed refresh doesn't blank the screen.
      setState((st) => ({ ...st, error, loading: false }));
    }
  }, [key]);
  useEffect(() => {
    load();
  }, [load]);
  return { ...state, reload: load, setData: (data) => setState((st) => ({ ...st, data })) };
}

export function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => sub.remove();
  }, []);
  return reduce;
}

// Content eases in once when it first appears (static when the OS asks for reduced motion).
export function FadeIn({ children, delay = 0, style }) {
  const reduce = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduce) {
      progress.setValue(1);
      return undefined;
    }
    const anim = Animated.timing(progress, { toValue: 1, duration: 260, delay, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [reduce, delay, progress]);
  return <Animated.View style={[style, { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>{children}</Animated.View>;
}

// --- Buttons ----------------------------------------------------------------------------
const VARIANTS = {
  primary: [colors.teal, colors.white],
  dark: [colors.navy, colors.white],
  soft: [colors.teal50, colors.teal700],
  secondary: [colors.surface, colors.navy],
  amber: [colors.amber, colors.navy],
  danger: [colors.danger, colors.white],
  ghost: ['transparent', colors.teal700],
  dangerGhost: ['transparent', colors.danger],
};

export function Button({ title, onPress, variant = 'primary', disabled, pending, style, size = 'md', icon, accessibilityHint }) {
  const [bg, fg] = VARIANTS[variant];
  const raised = ['primary', 'dark', 'amber', 'danger'].includes(variant);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled || pending), busy: Boolean(pending) }}
      onPress={onPress}
      disabled={disabled || pending}
      style={({ pressed }) => [
        s.button,
        size === 'sm' && { minHeight: 42, paddingHorizontal: 14, borderRadius: 12 },
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.88 : 1, transform: [{ scale: pressed ? 0.98 : 1 }], borderWidth: variant === 'secondary' ? 1 : 0 },
        raised && !disabled && shadow.sm,
        style,
      ]}
    >
      {pending ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} color={fg} /> : null}
          <Text style={[s.buttonText, { color: fg }, size === 'sm' && { fontSize: 14 }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

// Round icon-only control (header actions, close, favorite). Always carries a spoken label.
export function IconButton({ icon, label, onPress, filled, color = colors.navy, tone = 'surface', size = 42, set, badge }) {
  const bg = tone === 'glass' ? 'rgba(255,255,255,0.92)' : tone === 'clear' ? 'transparent' : colors.surface;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.75 : 1 }, tone === 'surface' && { borderWidth: 1, borderColor: colors.line }, tone === 'glass' && shadow.sm]}>
      <Icon name={icon} size={size * 0.48} color={color} filled={filled} set={set} />
      {badge ? <View style={{ position: 'absolute', top: 8, right: 9, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.amber, borderWidth: 1.5, borderColor: colors.white }} /> : null}
    </Pressable>
  );
}

// --- Inputs -----------------------------------------------------------------------------
// Text field: label with a required marker, a 52 pt input with a clear focus state, helper text,
// and an error that screen readers announce with the field.
export function Field({ label, hint, error, required, style, ...props }) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={[{ gap: 6 }, style]}>
      <Text style={s.label}>
        {label}
        {required ? <Text style={{ color: colors.danger }}> *</Text> : null}
      </Text>
      <TextInput
        accessibilityLabel={`${label}${required ? ', required' : ''}${error ? `, ${error}` : ''}`}
        accessibilityHint={hint}
        placeholderTextColor={colors.subtle}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={[s.input, focus && s.inputFocus, error && { borderColor: colors.danger }]}
        {...props}
      />
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
      {error ? (
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <Icon name="alert-circle" size={14} color={colors.danger} />
          <Text style={[s.hint, { color: colors.danger, fontWeight: '600', flex: 1 }]}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

// Search box: icon, clear button, search key on the keyboard.
export function SearchField({ value, onChangeText, onSubmit, placeholder = 'Search services or businesses', autoFocus, inputRef }) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={[s.search, focus && { borderColor: colors.teal, borderWidth: 2, paddingHorizontal: 13 }]}>
      <Icon name="search" size={19} color={focus ? colors.teal : colors.muted} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        autoFocus={autoFocus}
        returnKeyType="search"
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        accessibilityLabel={placeholder}
        maxLength={100}
        autoCorrect={false}
        style={{ flex: 1, fontFamily: fonts.text, fontSize: 16, color: colors.navy, paddingVertical: 0 }}
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={10}>
          <Icon name="x-circle" size={18} color={colors.subtle} />
        </Pressable>
      ) : null}
    </View>
  );
}

// --- Layout -------------------------------------------------------------------------------
export const Card = ({ children, style }) => <View style={[s.card, style]}>{children}</View>;
export const H1 = ({ children, style }) => (
  <Text style={[s.h1, style]} accessibilityRole="header">
    {children}
  </Text>
);
export const H2 = ({ children, style }) => (
  <Text style={[s.h2, style]} accessibilityRole="header">
    {children}
  </Text>
);
export const Muted = ({ children, style, numberOfLines }) => (
  <Text style={[s.muted, style]} numberOfLines={numberOfLines}>
    {children}
  </Text>
);

export function SectionHeader({ title, subtitle, action, onAction, style }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }, style]}>
      <View style={{ flex: 1 }}>
        <Text style={text.heading} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text style={[text.secondary, { color: colors.muted, marginTop: 2 }]}>{subtitle}</Text> : null}
      </View>
      {action ? (
        <Pressable onPress={onAction} accessibilityRole="button" accessibilityLabel={`${action}: ${title}`} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32 }}>
          <Text style={[text.label, { color: colors.teal700 }]}>{action}</Text>
          <Icon name="chevron-right" size={16} color={colors.teal700} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function Chip({ label, selected, onPress, icon, accent }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, minHeight: 38, borderRadius: 999, borderWidth: 1, opacity: pressed ? 0.85 : 1 },
        selected ? { backgroundColor: colors.navy, borderColor: colors.navy } : { backgroundColor: colors.surface, borderColor: colors.line },
      ]}
    >
      {icon ? <Icon name={icon} set="mci" size={16} color={selected ? colors.white : accent ?? colors.teal700} /> : null}
      <Text style={[text.label, { color: selected ? colors.white : colors.slate }]}>{label}</Text>
    </Pressable>
  );
}

// Menu row: tinted icon, title, optional subtitle, chevron.
export function ListRow({ icon, title, subtitle, onPress, accent = { fg: colors.teal700, bg: colors.teal50 }, last, danger, external }) {
  return (
    <Pressable onPress={onPress} accessibilityRole={external ? 'link' : 'button'} accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, paddingHorizontal: 16, backgroundColor: pressed ? colors.cloud : 'transparent' }, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.lineStrong }]}>
      <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: danger ? colors.danger50 : accent.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={18} color={danger ? colors.danger : accent.fg} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[text.bodyStrong, { color: danger ? colors.danger : colors.navy }]}>{title}</Text>
        {subtitle ? <Text style={[text.secondary, { color: colors.muted }]}>{subtitle}</Text> : null}
      </View>
      <Icon name={external ? 'external-link' : 'chevron-right'} size={18} color={colors.subtle} />
    </Pressable>
  );
}

// --- Skeletons -------------------------------------------------------------------------
// A gentle opacity pulse (static when the OS asks for reduced motion). Groups announce
// loading once to screen readers.
export function Skeleton({ style }) {
  const reduce = useReducedMotion();
  const [pulse] = useState(() => new Animated.Value(0.55));
  useEffect(() => {
    if (reduce) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, pulse]);
  return <Animated.View importantForAccessibility="no-hide-descendants" style={[{ backgroundColor: '#E6EAF0', borderRadius: radii.sm, opacity: pulse }, style]} />;
}

export function LoadingGroup({ label = 'Loading', children, style }) {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityState={{ busy: true }} style={style}>
      {children}
    </View>
  );
}

export function CompanyCardSkeleton({ compact }) {
  return (
    <View style={[s.companyCard, compact && { width: 248 }]}>
      <Skeleton style={{ height: compact ? 116 : 150, borderRadius: 0 }} />
      <View style={{ padding: 14, gap: 8 }}>
        <Skeleton style={{ height: 16, width: '70%' }} />
        <Skeleton style={{ height: 12, width: '45%' }} />
        <Skeleton style={{ height: 12, width: '35%' }} />
      </View>
    </View>
  );
}

export function CardListSkeleton({ count = 3, label = 'Loading businesses' }) {
  return (
    <LoadingGroup label={label} style={{ gap: 14 }}>
      {Array.from({ length: count }, (_, i) => (
        <CompanyCardSkeleton key={i} />
      ))}
    </LoadingGroup>
  );
}

export function RowSkeleton({ count = 4, label = 'Loading' }) {
  return (
    <LoadingGroup label={label} style={{ gap: 10 }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[s.card, { gap: 8 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Skeleton style={{ height: 16, width: '55%' }} />
            <Skeleton style={{ height: 20, width: 80, borderRadius: 999 }} />
          </View>
          <Skeleton style={{ height: 12, width: '35%' }} />
          <Skeleton style={{ height: 12, width: '50%' }} />
        </View>
      ))}
    </LoadingGroup>
  );
}

export function DetailSkeleton({ label = 'Loading details' }) {
  return (
    <LoadingGroup label={label} style={{ gap: 14 }}>
      <Skeleton style={{ height: 200, borderRadius: 0 }} />
      <View style={{ paddingHorizontal: 16, gap: 12 }}>
        <Skeleton style={{ height: 26, width: '65%' }} />
        <Skeleton style={{ height: 14, width: '40%' }} />
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} style={{ height: 88, borderRadius: radius }} />
        ))}
      </View>
    </LoadingGroup>
  );
}

// --- Feedback --------------------------------------------------------------------------
export function ErrorView({ error, onRetry, title }) {
  const offline = error?.code === 'NETWORK_ERROR';
  return (
    <Card style={{ alignItems: 'center', gap: 8, paddingVertical: 26 }}>
      <View style={[s.iconBubble, { backgroundColor: colors.danger50 }]}>
        <Icon name={offline ? 'wifi-off' : 'alert-circle'} size={22} color={colors.danger} />
      </View>
      <Text style={[s.h2, { textAlign: 'center' }]} accessibilityRole="alert">
        {title ?? (offline ? "You're offline" : "This didn't load")}
      </Text>
      <Text style={[s.muted, { textAlign: 'center' }]}>{offline ? 'Check your connection, then try again.' : error?.message}</Text>
      {onRetry ? <Button title="Try again" icon="refresh-cw" variant="secondary" size="sm" onPress={onRetry} style={{ marginTop: 6 }} /> : null}
    </Card>
  );
}

export function InlineError({ error, onRetry }) {
  return (
    <Pressable onPress={onRetry} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.amber50, borderColor: '#F6D58F', borderWidth: 1, borderRadius: radii.md, padding: 12 }}>
      <Icon name="wifi-off" size={16} color={colors.amberText} />
      <Text style={[text.secondary, { color: colors.amberText, flex: 1 }]}>{error?.code === 'NETWORK_ERROR' ? "You're offline — showing earlier results. Tap to retry." : "Couldn't refresh. Tap to retry."}</Text>
    </Pressable>
  );
}

export function Empty({ title, body, icon = 'search', action }) {
  return (
    <View style={{ alignItems: 'center', gap: 8, paddingVertical: 32, paddingHorizontal: 20 }}>
      <View style={[s.iconBubble, { width: 64, height: 64, borderRadius: 32 }]}>
        <Icon name={icon} size={26} color={colors.teal700} />
      </View>
      <Text style={[s.h2, { textAlign: 'center' }]}>{title}</Text>
      {body ? <Text style={[s.muted, { textAlign: 'center', maxWidth: 300 }]}>{body}</Text> : null}
      {action ? <View style={{ marginTop: 8, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

// Inline error or notice under a form.
export function FormMessage({ text: message }) {
  return (
    <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: colors.danger50, borderRadius: radii.md, padding: 12 }}>
      <Icon name="alert-circle" size={16} color={colors.danger} style={{ marginTop: 2 }} />
      <Text style={[text.label, { flex: 1, color: colors.danger }]}>{message}</Text>
    </View>
  );
}

const TONE = { teal: [colors.teal50, colors.teal700], amber: [colors.amber50, colors.amberText], navy: [colors.navy, colors.white], slate: [colors.cloud, colors.muted], red: [colors.danger50, colors.danger] };
export function TonePill({ label, tone = 'slate', icon }) {
  const [bg, fg] = TONE[tone] ?? TONE.slate;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }}>
      {icon ? <Icon name={icon} size={12} color={fg} /> : null}
      <Text style={[text.caption, { color: fg, fontWeight: '700' }]}>{label}</Text>
    </View>
  );
}

export function StatusPill({ status }) {
  const [bg, fg] = TONE[BOOKING_STATUS_TONE[status] ?? 'slate'];
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: fg }} />
      <Text style={[text.caption, { color: fg, fontWeight: '700' }]}>{BOOKING_STATUS_LABELS[status] ?? status}</Text>
    </View>
  );
}

// --- Bottom-sheet selector -------------------------------------------------------------
// Native-feeling picker: a sheet with large rows, a check on the current value, and a search
// field when the list is long (e.g. countries).
export function SelectSheet({ label, value, options, onChange, searchable }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const current = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);
  const search = searchable ?? options.length > 10;
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${label}: ${current?.label ?? 'not set'}`} accessibilityHint="Opens a list of options" style={[s.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
        <Text style={{ fontSize: 16, color: current ? colors.navy : colors.subtle }}>{current?.label ?? 'Select'}</Text>
        <Icon name="chevron-down" color={colors.muted} />
      </Pressable>
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top', 'bottom']}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
            <Text style={s.h2}>{label}</Text>
            <Pressable onPress={() => setOpen(false)} accessibilityRole="button" hitSlop={12}>
              <Text style={[text.bodyStrong, { color: colors.teal700, fontSize: 16 }]}>Done</Text>
            </Pressable>
          </View>
          {search ? (
            <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
              <SearchField value={query} onChangeText={setQuery} placeholder={`Search ${label.toLowerCase()}`} />
            </View>
          ) : null}
          <FlatList
            data={filtered}
            keyExtractor={(o) => o.value}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={[s.muted, { textAlign: 'center', padding: 24 }]}>No matches</Text>}
            renderItem={({ item }) => {
              const on = item.value === value;
              return (
                <Pressable
                  onPress={() => {
                    onChange(item.value);
                    setOpen(false);
                    setQuery('');
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={({ pressed }) => ({ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, minHeight: 52, alignItems: 'center', backgroundColor: pressed ? colors.teal50 : 'transparent', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line })}
                >
                  <Text style={{ fontSize: 16, color: on ? colors.teal700 : colors.slate, fontWeight: on ? '700' : '400' }}>{item.label}</Text>
                  {on ? <Icon name="check" color={colors.teal700} /> : null}
                </Pressable>
              );
            }}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

export const imageUrl = (url, w, h) => (url && url.includes('/image/upload/') ? url.replace('/image/upload/', `/image/upload/f_auto,q_auto,w_${w},h_${h},c_fill/`) : url);

// --- Categories & businesses ------------------------------------------------------------
// Tinted square with the category glyph.
export function CategoryBadge({ look, size = 52, radius: r = 16 }) {
  return (
    <View style={{ width: size, height: size, borderRadius: r, backgroundColor: look.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon set="mci" name={look.icon} size={size * 0.5} color={look.fg} />
    </View>
  );
}

export function CategoryTile({ name, look, onPress, width }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" accessibilityLabel={name} style={({ pressed }) => ({ width, alignItems: 'center', gap: 8, transform: [{ scale: pressed ? 0.95 : 1 }] })}>
      <CategoryBadge look={look} size={60} radius={20} />
      <Text numberOfLines={2} style={[text.caption, { color: colors.slate, textAlign: 'center', fontWeight: '600', fontSize: 12.5 }]}>
        {name}
      </Text>
    </Pressable>
  );
}

export function Rating({ rating, isNew, light }) {
  if (rating?.count) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} accessible accessibilityLabel={`Rated ${rating.average.toFixed(1)} out of 5 from ${rating.count} review${rating.count === 1 ? '' : 's'}`}>
        <Icon filled name="star" size={14} color={colors.amber} />
        <Text style={[text.label, { color: light ? colors.white : colors.navy }]}>{rating.average.toFixed(1)}</Text>
        <Text style={[text.secondary, { color: light ? 'rgba(255,255,255,0.8)' : colors.muted }]}>({rating.count})</Text>
      </View>
    );
  }
  return <Text style={[text.secondary, { color: light ? 'rgba(255,255,255,0.85)' : colors.muted }]}>{isNew ? 'New · no reviews yet' : 'No reviews yet'}</Text>;
}

// Cover photo, or — when the business hasn't uploaded one — its category colour and glyph.
// Never a stock photo standing in for a real business.
export function Cover({ image, look, height, w = 720, initial, children }) {
  return (
    <View style={{ height, backgroundColor: look.bg, overflow: 'hidden' }}>
      {image ? (
        <Image source={{ uri: imageUrl(image.url, w, Math.round((w * height) / 360)) }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
      ) : (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <Icon set="mci" name={look.icon} size={Math.min(64, height * 0.42)} color={look.fg} style={{ opacity: 0.85 }} />
          {initial ? <Icon set="mci" name={look.icon} size={height * 1.1} color={look.fg} style={{ position: 'absolute', right: -height * 0.18, bottom: -height * 0.3, opacity: 0.08 }} /> : null}
        </View>
      )}
      {children}
    </View>
  );
}

export function CompanyCard({ company, look, onPress, favorite, onToggleFavorite, compact }) {
  const place = [company.location?.area, company.location?.city].filter(Boolean).join(', ');
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`${company.name}, ${company.category?.name ?? 'local service'}${place ? `, ${place}` : ''}`} onPress={onPress} style={({ pressed }) => [s.companyCard, compact && { width: 248 }, { transform: [{ scale: pressed ? 0.985 : 1 }] }]}>
      <Cover image={company.cover} look={look} height={compact ? 116 : 150} initial>
        <View style={{ position: 'absolute', left: 10, top: 10, flexDirection: 'row', gap: 6 }}>
          {company.isNew ? <Badge label="New" tone="navy" /> : null}
          {company.verified ? <Badge label="Verified" tone="teal" icon="check-circle" /> : null}
        </View>
        {onToggleFavorite ? (
          <View style={{ position: 'absolute', right: 8, top: 8 }}>
            <IconButton tone="glass" size={38} icon={favorite ? 'heart' : 'heart-outline'} filled color={favorite ? colors.danger : colors.navy} label={favorite ? `Remove ${company.name} from saved` : `Save ${company.name}`} onPress={() => onToggleFavorite(company)} />
          </View>
        ) : null}
      </Cover>
      <View style={{ padding: 14, gap: 4 }}>
        <Text style={text.cardTitle} numberOfLines={1}>
          {company.name}
        </Text>
        <Text style={[text.secondary, { color: colors.muted }]} numberOfLines={1}>
          {company.category?.name ?? 'Local service'}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name="map-pin" size={12} color={colors.muted} />
          <Text style={[text.secondary, { color: colors.muted, flexShrink: 1 }]} numberOfLines={1}>
            {[place || null, company.serviceMode && company.serviceMode !== 'fixed' ? 'Comes to you' : null, company.distanceKm != null ? `${company.distanceKm} km` : null].filter(Boolean).join(' · ') || 'Location not listed'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
          <Rating rating={company.rating} isNew={company.isNew} />
          {priceFromLabel(company.priceFrom) ? <Text style={[text.label, { color: colors.teal700 }]}>{priceFromLabel(company.priceFrom)}</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

export function Badge({ label, tone = 'navy', icon }) {
  const [bg, fg] = tone === 'teal' ? [colors.white, colors.teal700] : tone === 'amber' ? [colors.amber, colors.navy] : [colors.navy, colors.white];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: bg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
      {icon ? <Icon name={icon} size={11} color={fg} /> : null}
      <Text style={[text.caption, { color: fg, fontWeight: '700', fontSize: 11 }]}>{label}</Text>
    </View>
  );
}

export const s = StyleSheet.create({
  text: { fontFamily: fonts.text, fontSize: 15, color: colors.slate },
  screen: { padding: 16, gap: 14, paddingBottom: 48 },
  button: { minHeight: 52, borderRadius: 14, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', borderColor: colors.lineStrong },
  buttonText: { fontFamily: fonts.text, fontSize: 16, fontWeight: '700' },
  iconButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.cloud, alignItems: 'center', justifyContent: 'center' },
  label: { ...text.label, color: colors.navy },
  hint: { ...text.caption, color: colors.muted, fontWeight: '400', fontSize: 12.5 },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: 14, paddingHorizontal: 14, fontFamily: fonts.text, fontSize: 16, color: colors.navy, backgroundColor: colors.surface },
  inputFocus: { borderColor: colors.teal, borderWidth: 2, paddingHorizontal: 13 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, borderRadius: 16, paddingHorizontal: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  card: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.line, padding: 16, ...shadow.sm },
  companyCard: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', ...shadow.sm },
  iconBubble: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.teal50, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  h1: { ...text.title, color: colors.navy },
  h2: { ...text.cardTitle, fontSize: 17, color: colors.navy },
  muted: { ...text.body, fontSize: 14, lineHeight: 20, color: colors.muted },
});
