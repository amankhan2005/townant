import { useState } from 'react';
import { LayoutAnimation, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { FAQ } from '../src/faq.js';
import { colors, radius, text } from '../src/theme.js';
import { Icon, Text } from '../src/ui.jsx';

export default function Faq() {
  const [open, setOpen] = useState(0);
  const toggle = (i) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((cur) => (cur === i ? -1 : i));
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <View style={styles.panel}>
        {FAQ.map(([q, a], i) => {
          const expanded = open === i;
          return (
            <View key={q} style={i ? { borderTopWidth: 1, borderColor: colors.line } : null}>
              <Pressable onPress={() => toggle(i)} accessibilityRole="button" accessibilityState={{ expanded }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 15, backgroundColor: pressed ? colors.cloud : 'transparent' })}>
                <Text style={[text.bodyStrong, { color: colors.navy, flex: 1 }]}>{q}</Text>
                <Icon name={expanded ? 'minus' : 'plus'} size={18} color={colors.teal700} />
              </Pressable>
              {expanded ? <Text style={[text.body, { color: colors.slate, paddingHorizontal: 16, paddingBottom: 16 }]}>{a}</Text> : null}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
});
