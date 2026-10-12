import { Image } from 'expo-image';
import { ActivityIndicator, StyleSheet, useWindowDimensions, View } from 'react-native';

const SPLASH_LOGO = require('../assets/images/moozzle-splash-logo.png');
const LOGO_RATIO = 1400 / 406;
export const SPLASH_BACKGROUND = '#FFFFFF';
const BRAND_NAVY = '#10192B';

/**
 * Full-screen branded loading view shown while fonts or the auth session initialise.
 * Matches the native splash (white background, navy logo) so there is no blank flash,
 * and keeps the complete logo + tagline inside generous side padding.
 */
export function BrandSplash({ overlay = false }: { overlay?: boolean }) {
  const { width } = useWindowDimensions();
  const logoWidth = Math.min(width * 0.78, 420);

  return (
    <View
      style={[styles.container, overlay && StyleSheet.absoluteFill]}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading MOOZZLE"
    >
      <Image
        source={SPLASH_LOGO}
        contentFit="contain"
        style={{ width: logoWidth, height: logoWidth / LOGO_RATIO }}
        accessibilityLabel="MOOZZLE – Bovine Muzzle Biometric Identification"
      />
      <ActivityIndicator color={BRAND_NAVY} style={styles.spinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: SPLASH_BACKGROUND,
    zIndex: 100,
  },
  spinner: { marginTop: 36 },
});
