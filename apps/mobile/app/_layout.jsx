import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AuthProvider } from '../src/auth.jsx';
import { CatalogProvider } from '../src/catalog.jsx';
import { FavoritesProvider } from '../src/favorites.jsx';
import { LocationProvider } from '../src/location.jsx';
import { linkFromNotification } from '../src/push.js';
import { colors, fonts } from '../src/theme.js';

function NotificationRouter() {
  const router = useRouter();
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const link = linkFromNotification(response);
      if (link) router.push(link);
    });
    return () => sub.remove();
  }, [router]);
  return null;
}

const screenOptions = {
  headerTintColor: colors.navy,
  headerTitleStyle: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 18, color: colors.navy },
  headerShadowVisible: false,
  headerStyle: { backgroundColor: colors.cloud },
  contentStyle: { backgroundColor: colors.cloud },
  headerBackButtonDisplayMode: 'minimal',
};

export default function RootLayout() {
  return (
    <AuthProvider>
      <CatalogProvider>
        <LocationProvider>
          <FavoritesProvider>
            <StatusBar style="dark" />
            <NotificationRouter />
            <Stack screenOptions={screenOptions}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="b/[slug]/index" options={{ headerShown: false }} />
              <Stack.Screen name="b/[slug]/[serviceId]" options={{ title: 'Service' }} />
              <Stack.Screen name="category/[slug]" options={{ title: '' }} />
              <Stack.Screen name="book/[slug]" options={{ title: 'Choose a time', presentation: 'modal' }} />
              <Stack.Screen name="bookings/[id]" options={{ title: 'Booking' }} />
              <Stack.Screen name="login" options={{ title: '', presentation: 'modal' }} />
              <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
              <Stack.Screen name="help" options={{ title: 'Help & Support' }} />
              <Stack.Screen name="faq" options={{ title: 'FAQs' }} />
              <Stack.Screen name="about" options={{ title: 'About TownAnt' }} />
              <Stack.Screen name="profile/edit" options={{ title: 'Edit profile' }} />
              <Stack.Screen name="settings" options={{ title: 'Account settings' }} />
              <Stack.Screen name="legal/[doc]" options={{ title: '' }} />
              <Stack.Screen name="support/index" options={{ title: 'My support requests' }} />
              <Stack.Screen name="support/new" options={{ title: 'Contact us', presentation: 'modal' }} />
              <Stack.Screen name="support/[id]" options={{ title: 'Support request' }} />
              <Stack.Screen name="account-delete" options={{ title: 'Delete account' }} />
            </Stack>
          </FavoritesProvider>
        </LocationProvider>
      </CatalogProvider>
    </AuthProvider>
  );
}
