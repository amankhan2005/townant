import { daysInMonth, formatIsoDate, todayIso, weekdayOfIso } from '@townant/shared';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { colors, radii } from './theme.js';
import { Text } from './ui.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function addMonths(first, n) {
  let [y, m] = first.split('-').map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = ((((m - 1) % 12) + 12) % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

// Month grid over date-only ISO strings. `meta(iso)` returns { short, label } for per-day
// availability; `isDisabled(iso)` blocks days. Each cell is a 44pt+ touch target.
export function Calendar({ value, onSelect, min, timeZone, isDisabled, meta, onViewChange }) {
  const today = todayIso(timeZone);
  const [view, setView] = useState(`${(value ?? today).slice(0, 7)}-01`);
  useEffect(() => {
    onViewChange?.(view);
  }, [view, onViewChange]);

  const [y, m] = view.split('-').map(Number);
  const lead = weekdayOfIso(view);
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth(y, m) }, (_, i) => `${view.slice(0, 8)}${String(i + 1).padStart(2, '0')}`)];
  while (cells.length % 7) cells.push(null);
  const canPrev = !min || addMonths(view, -1) >= `${min.slice(0, 7)}-01`;

  const nav = (label, n, enabled) => (
    <Pressable onPress={() => setView(addMonths(view, n))} disabled={!enabled} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: enabled ? 1 : 0.3 }}>
      <Text style={{ fontSize: 22, color: colors.navy }}>{n < 0 ? '‹' : '›'}</Text>
    </Pressable>
  );

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        {nav('Previous month', -1, canPrev)}
        <Text style={{ fontSize: 16, fontWeight: '700', color: colors.navy }} accessibilityRole="header" accessibilityLiveRegion="polite">
          {MONTHS[m - 1]} {y}
        </Text>
        {nav('Next month', 1, true)}
      </View>
      <View style={{ flexDirection: 'row' }}>
        {DOW.map((d, i) => (
          <Text key={i} style={{ flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '700', color: colors.subtle, paddingBottom: 4 }} importantForAccessibility="no">
            {d}
          </Text>
        ))}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, w) => (
        <View key={w} style={{ flexDirection: 'row' }}>
          {cells.slice(w * 7, w * 7 + 7).map((iso, di) => {
            if (!iso) return <View key={`e${di}`} style={{ flex: 1, height: 52 }} />;
            const off = (min && iso < min) || Boolean(isDisabled?.(iso));
            const selected = iso === value;
            const isToday = iso === today;
            const info = meta?.(iso);
            return (
              <Pressable
                key={iso}
                disabled={off}
                onPress={() => onSelect(iso)}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: off }}
                accessibilityLabel={`${DOW_LONG[di]}, ${formatIsoDate(iso)}${isToday ? ', today' : ''}${info?.label ? `, ${info.label}` : ''}${off ? ', unavailable' : ''}`}
                style={{ flex: 1, height: 52, padding: 2 }}
              >
                <View style={{ flex: 1, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? colors.teal : 'transparent', borderWidth: isToday && !selected ? 1 : 0, borderColor: colors.teal }}>
                  <Text style={{ fontSize: 15, fontWeight: selected || isToday ? '800' : '500', color: selected ? colors.surface : off ? colors.lineStrong : colors.navy, textDecorationLine: off ? 'line-through' : 'none' }}>{Number(iso.slice(8))}</Text>
                  {info?.short ? <Text style={{ fontSize: 9, color: selected ? 'rgba(255,255,255,0.85)' : off ? colors.lineStrong : colors.teal700 }}>{info.short}</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
