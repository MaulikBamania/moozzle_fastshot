import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const KEY = 'moozzle.device-id';
let cached: string | null = null;

/** Stable per-installation identifier (MZ-XXXX-XXXX), created on first use and kept on the device. */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (stored) {
      cached = stored;
      return stored;
    }
    const raw = Crypto.randomUUID().replace(/-/g, '').toUpperCase();
    const id = `MZ-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    await AsyncStorage.setItem(KEY, id);
    cached = id;
    return id;
  } catch (caught) {
    console.warn('Device ID unavailable', caught);
    return 'Unavailable';
  }
}
