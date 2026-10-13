import { Image } from 'expo-image';
import { ActivityIndicator, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

// Navy artwork of the full official logo: emblem, "MOOZZLE" wordmark and tagline.
const SPLASH_LOGO = require('../assets/images/moozzle-splash-logo.png');
const LOGO_RATIO = 1400 / 406;
const HORIZONTAL_PADDING = 32;
export const SPLASH_BACKGROUND = '#FFFFFF';
const BRAND_NAVY = '#10192B';

/**
 * Full-screen branded loading view shown while fonts or the auth session initialise.
 * Matches the native splash (white background, navy logo) so there is no blank flash.
 * The logo is sized from both window width and height so it never clips on any viewport.
 */
export function BrandSplash({ overlay = false }: { overlay?: boolean }) {
  const { width, height } = useWindowDimensions();
  const maxByWidth = Math.max(width - HORIZONTAL_PADDING * 2, 0) * 0.9;
  const maxByHeight = height * 0.3 * LOGO_RATIO;
  const logoWidth = Math.min(maxByWidth, maxByHeight, 440);

  return (
    <Animated.View
      exiting={FadeOut.duration(280)}
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
      <ActivityIndicator size="small" color={BRAND_NAVY} style={styles.spinner} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingVertical: 48,
    backgroundColor: SPLASH_BACKGROUND,
    zIndex: 100,
  },
  spinner: { marginTop: 40 },
});
