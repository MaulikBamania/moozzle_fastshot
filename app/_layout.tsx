import { AuthProvider, useAuth } from "@fastshot/auth";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { FontMap } from "@/constants/Typography";
import { supabase } from "@/lib/supabase";
import { setActiveUser } from "@/store/useBovineStore";
import { useConnectivityMonitor } from "@/store/useConnectivity";

SplashScreen.preventAutoHideAsync();

const AUTH_ROUTES = {
  login: "/(auth)/login",
  afterLogin: "/(tabs)",
  protected: ["(tabs)", "register", "animal", "sync", "performance", "api-docs", "about", "profile"],
  guest: ["(auth)"],
};

/** Points the data store at the signed-in account; clears it on sign-out. */
function SessionBridge({ children }: { children: React.ReactNode }) {
  const { user, isInitializing } = useAuth();
  const userId = user?.id ?? null;
  useConnectivityMonitor();

  useEffect(() => {
    if (!isInitializing) setActiveUser(userId);
  }, [isInitializing, userId]);

  return <>{children}</>;
}

export default function RootLayout() {
  const [loaded, error] = useFonts(FontMap);

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !error) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider supabaseClient={supabase} routes={AUTH_ROUTES}>
          <SessionBridge>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="auth/callback" />
              <Stack.Screen name="register" options={{ presentation: 'card' }} />
              <Stack.Screen name="animal/[id]" options={{ presentation: 'card' }} />
              <Stack.Screen name="sync" options={{ presentation: 'card' }} />
              <Stack.Screen name="profile" options={{ presentation: 'card' }} />
              <Stack.Screen name="performance" options={{ presentation: 'card' }} />
              <Stack.Screen name="api-docs" options={{ presentation: 'card' }} />
              <Stack.Screen name="about" options={{ presentation: 'card' }} />
            </Stack>
          </SessionBridge>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
