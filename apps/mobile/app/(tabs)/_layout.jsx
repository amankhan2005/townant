import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { colors, fonts } from '../../src/theme.js';
import { Icon } from '../../src/ui.jsx';

// Five destinations. Home, Explore, Saved and Profile work without an account; Bookings explains
// what signing in unlocks.
function TabIcon({ name, color, focused }) {
  return (
    <View style={{ width: 56, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? colors.teal50 : 'transparent' }}>
      <Icon name={name} size={21} color={color} />
    </View>
  );
}
const icon =
  (name) =>
  function TabBarIcon({ color, focused }) {
    return <TabIcon name={name} color={color} focused={focused} />;
  };

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.teal700,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: fonts.text, fontWeight: '600', fontSize: 11.5, marginTop: 2 },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, paddingTop: 6 },
        headerTitleStyle: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 20, color: colors.navy },
        headerStyle: { backgroundColor: colors.cloud },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.cloud },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', headerShown: false, tabBarIcon: icon('home') }} />
      <Tabs.Screen name="explore" options={{ title: 'Explore', headerShown: false, tabBarIcon: icon('compass') }} />
      <Tabs.Screen name="bookings" options={{ title: 'Bookings', tabBarIcon: icon('calendar') }} />
      <Tabs.Screen name="favorites" options={{ title: 'Saved', tabBarIcon: icon('heart') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('user') }} />
    </Tabs>
  );
}
