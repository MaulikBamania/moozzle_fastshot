import { AuthCallbackPage } from '@fastshot/auth';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';

export default function AuthCallback() {
  const router = useRouter();
  return (
    <AuthCallbackPage
      supabaseClient={supabase}
      onSuccess={() => router.replace('/(tabs)')}
      onError={(error) => router.replace(`/(auth)/login?error=${encodeURIComponent(error.message)}`)}
      loadingText="Completing sign in…"
    />
  );
}
