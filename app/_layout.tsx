import { AuthProvider, useAuth } from "@fastshot/auth";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BrandSplash } from "@/components/brand-splash";
import { FontMap } from "@/constants/Typography";
import { supabase } from "@/lib/supabase";
import { logAudit, setActiveUser } from "@/store/useBovineStore";
import { useConnectivityMonitor } from "@/store/useConnectivity";

SplashScreen.preventAutoHideAsync();

const AUTH_ROUTES = {
  login: "/(auth)/login",
  afterLogin: "/(tabs)",
  protected: ["(tabs)", "register", "animal", "sync", "performance", "api-docs", "about", "profile", "notifications", "audit", "approvals", "requests", "reports", "users", "permissions", "platform-settings", "security", "api-clients", "research", "services", "verify", "permission-denied"],
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

  // Overlay (rather than replace) the navigator so routes stay mounted for auth redirects.
  return (
    <>
      {children}
      {isInitializing ? <BrandSplash overlay /> : null}
    </>
  );
}

// Called by the auth SDK after a successful sign-in; the server derives the user and role.
function handleSignIn() {
  setTimeout(() => void logAudit("auth.login", "", "Signed in", "success"), 1500);
}

export default function RootLayout() {
  const [loaded, error] = useFonts(FontMap);

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync().catch((err: unknown) => {
        console.error("Failed to hide native splash screen", err);
      });
    }
  }, [loaded, error]);

  if (!loaded && !error) {
    return <BrandSplash />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider supabaseClient={supabase} routes={AUTH_ROUTES} onSignIn={handleSignIn}>
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
              <Stack.Screen name="analytics" options={{ presentation: 'card' }} />
              <Stack.Screen name="api-docs" options={{ presentation: 'card' }} />
              <Stack.Screen name="about" options={{ presentation: 'card' }} />
              <Stack.Screen name="notifications" />
              <Stack.Screen name="audit" />
              <Stack.Screen name="approvals" />
              <Stack.Screen name="requests" />
              <Stack.Screen name="reports" />
              <Stack.Screen name="users" />
              <Stack.Screen name="permissions" />
              <Stack.Screen name="platform-settings" />
              <Stack.Screen name="security" />
              <Stack.Screen name="api-clients" />
              <Stack.Screen name="research" />
              <Stack.Screen name="services" />
              <Stack.Screen name="verify" />
              <Stack.Screen name="permission-denied" />
            </Stack>
          </SessionBridge>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
