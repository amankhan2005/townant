import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Linking, ScrollView, View } from 'react-native';
import { LEGAL } from '../../src/legal.js';
import { accents, colors, radius, text } from '../../src/theme.js';
import { Button, Empty, Icon, Text } from '../../src/ui.jsx';

// Terms of use and Privacy notice — public, no sign-in. See src/legal.js for where the text comes
// from and why nothing is shown as legal text until it has been approved.
export default function LegalScreen() {
  const { doc } = useLocalSearchParams();
  const router = useRouter();
  const d = LEGAL[doc];
  if (!d) {
    return (
      <View style={{ padding: 16 }}>
        <Empty icon="file-text" title="Page not found" action={<Button title="Help & FAQ" onPress={() => router.replace('/help')} />} />
      </View>
    );
  }
  const drafted = d.sections.some((sec) => sec.body);
  const accent = doc === 'privacy' ? accents.violet : accents.blue;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 16 }}>
      <Stack.Screen options={{ title: d.title }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: accent.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={doc === 'privacy' ? 'lock' : 'file-text'} size={24} color={accent.fg} />
        </View>
        <Text style={[text.title, { color: colors.navy, flex: 1 }]} accessibilityRole="header">
          {d.title}
        </Text>
      </View>

      {d.url ? (
        <View style={{ backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 12 }}>
          <Text style={[text.body, { color: colors.slate }]}>The current {d.title} is published on the TownAnt website.</Text>
          <Button title={`Read the ${d.title}`} icon="external-link" onPress={() => Linking.openURL(d.url)} />
        </View>
      ) : !drafted ? (
        <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: 10, backgroundColor: colors.amber50, borderColor: '#F6D58F', borderWidth: 1, borderRadius: radius, padding: 14 }}>
          <Icon name="alert-triangle" size={18} color={colors.amberText} style={{ marginTop: 2 }} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[text.label, { color: colors.amberText }]}>Awaiting legal review — not yet in effect</Text>
            <Text style={[text.secondary, { color: colors.amberText, fontSize: 14, lineHeight: 20 }]}>
              The approved {d.title} will appear here once it has been reviewed. Below is the outline it will follow. Questions in the meantime? Contact TownAnt from Help & FAQ.
            </Text>
          </View>
        </View>
      ) : null}

      {!d.url ? (
        <View style={{ backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.line, paddingVertical: 6 }}>
          {d.sections.map((sec, i) => (
            <View key={sec.heading} style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 6, borderTopWidth: i ? 1 : 0, borderColor: colors.line }}>
              <Text style={[text.cardTitle, { color: colors.navy }]} accessibilityRole="header">
                {i + 1}. {sec.heading}
              </Text>
              {sec.body ? (
                sec.body.map((block, j) =>
                  Array.isArray(block) && block[0] === 'list' ? (
                    <View key={j} style={{ gap: 4 }}>
                      {block.slice(1).map((item) => (
                        <View key={item} style={{ flexDirection: 'row', gap: 8 }}>
                          <Text style={[text.body, { color: colors.slate }]}>•</Text>
                          <Text style={[text.body, { color: colors.slate, flex: 1 }]}>{item}</Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text key={j} style={[text.body, { color: colors.slate }]}>
                      {block}
                    </Text>
                  ),
                )
              ) : (
                <Text style={[text.secondary, { color: colors.muted, fontStyle: 'italic' }]}>Approved text pending</Text>
              )}
            </View>
          ))}
        </View>
      ) : null}

      <Button title="Help & FAQ" variant="secondary" icon="help-circle" onPress={() => router.push('/help')} />
    </ScrollView>
  );
}
