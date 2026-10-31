import Constants from 'expo-constants';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { colors, radius, text } from '../src/theme.js';
import { Muted, Text } from '../src/ui.jsx';

const mark = require('../assets/adaptive-icon.png');

// What TownAnt is, in plain terms — only statements that describe how the product works.
const POINTS = [
  ['Find local services', 'Search by service, category, business or place, and browse businesses that are based in, or serve, your area.'],
  ['Real availability', 'Times you can book come from each business’s own schedule on TownAnt.'],
  ['Businesses run their own listings', 'Each business manages its profile, services, prices and hours.'],
  ['No payments through TownAnt', 'Prices are for information. You pay the business directly.'],
];

export default function About() {
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}>
      <View style={{ alignItems: 'center', gap: 4, marginVertical: 8 }}>
        <Image source={mark} style={{ width: 80, height: 80 }} accessibilityIgnoresInvertColors />
        <Text style={[text.title, { color: colors.navy }]} accessibilityRole="header">
          Town<Text style={{ color: colors.teal }}>Ant</Text>
        </Text>
        <Muted>Find local. Book confidently.</Muted>
      </View>
      <View style={styles.panel}>
        {POINTS.map(([title, body], i) => (
          <View key={title} style={{ padding: 16, gap: 4, borderTopWidth: i ? 1 : 0, borderColor: colors.line }}>
            <Text style={[text.cardTitle, { color: colors.navy }]}>{title}</Text>
            <Text style={[text.body, { color: colors.slate }]}>{body}</Text>
          </View>
        ))}
      </View>
      <Muted style={{ textAlign: 'center', fontSize: 12 }}>Version {Constants.expoConfig?.version ?? '—'}</Muted>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
});
