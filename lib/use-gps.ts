import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';
import type { GpsFix } from '@/store/types';

/** Fixes worse than this are network/IP-grade, not a field GPS position, and are rejected. */
export const MAX_GPS_ACCURACY_M = 500;
const FIX_TIMEOUT_MS = 30000;

export type GpsStatus = 'idle' | 'locating' | 'ready' | 'denied' | 'blocked' | 'services_off' | 'error';

export interface GpsState {
  status: GpsStatus;
  fix: GpsFix | null;
  error: string;
}

class GpsError extends Error {
  constructor(
    message: string,
    readonly status: GpsStatus
  ) {
    super(message);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new GpsError('The GPS position could not be obtained in time. Move to an open area with a clear view of the sky and retry.', 'error')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function toFix(position: Location.LocationObject): GpsFix {
  const { latitude, longitude, accuracy } = position.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || (latitude === 0 && longitude === 0)) {
    throw new GpsError('The device returned invalid coordinates. Retry the GPS capture.', 'error');
  }
  if (position.mocked) {
    throw new GpsError('A mock (simulated) location was detected. Turn off mock-location apps and retry.', 'error');
  }
  const acc = typeof accuracy === 'number' && Number.isFinite(accuracy) ? accuracy : null;
  if (acc !== null && acc > MAX_GPS_ACCURACY_M) {
    throw new GpsError(`GPS accuracy is too low (±${Math.round(acc)} m). Enable precise location, move outdoors and retry.`, 'error');
  }
  const stamp = Number.isFinite(position.timestamp) && position.timestamp > 0 ? new Date(position.timestamp) : new Date();
  return { latitude, longitude, accuracy: acc, capturedAt: stamp.toISOString(), mocked: false };
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);
  return '';
}

/**
 * Compulsory registration GPS from the operating system's location services.
 * Never substitutes default, manual or IP-derived coordinates: without a valid fix `fix` stays null.
 * Permission is requested only from the user's Capture action; an already-granted permission captures on mount.
 */
export function useGpsCapture() {
  const [state, setState] = useState<GpsState>({ status: 'idle', fix: null, error: '' });
  const busy = useRef(false);
  const mounted = useRef(true);

  const update = useCallback((next: GpsState) => {
    if (mounted.current) setState(next);
  }, []);

  const capture = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    update({ status: 'locating', fix: null, error: '' });
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        throw permission.canAskAgain
          ? new GpsError('Location permission was declined. GPS is compulsory for registration — tap Capture GPS and choose Allow.', 'denied')
          : new GpsError('Location permission is blocked for MOOZZLE. Open Settings, allow Location (precise), then return and retry.', 'blocked');
      }
      let servicesOn = true;
      try {
        servicesOn = await Location.hasServicesEnabledAsync();
      } catch (error) {
        console.warn('Could not read location services state', error);
      }
      if (!servicesOn && Platform.OS === 'android') {
        try {
          // Shows Android's system dialog to switch location on.
          await Location.enableNetworkProviderAsync();
          servicesOn = true;
        } catch (error) {
          console.warn('User did not enable location services', error);
        }
      }
      if (!servicesOn) {
        throw new GpsError('Location services (GPS) are turned off on this device. Turn on Location in the phone settings, then retry.', 'services_off');
      }
      const position = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }), FIX_TIMEOUT_MS);
      update({ status: 'ready', fix: toFix(position), error: '' });
    } catch (error) {
      console.error('GPS capture failed', error);
      if (error instanceof GpsError) {
        update({ status: error.status, fix: null, error: error.message });
      } else {
        const text = messageOf(error);
        const servicesOff = /location services|provider|disabled|unavailable/i.test(text);
        update({
          status: servicesOff ? 'services_off' : 'error',
          fix: null,
          error: servicesOff
            ? 'Location services are unavailable. Turn on Location (GPS) on this device, then retry.'
            : `The GPS position could not be obtained${text ? ` (${text})` : ''}. Move outdoors and retry.`,
        });
      }
    } finally {
      busy.current = false;
    }
  }, [update]);

  // Capture straight away only when the user has already granted permission; otherwise wait for the tap.
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    Location.getForegroundPermissionsAsync()
      .then((permission) => {
        if (!cancelled && permission.granted) void capture();
      })
      .catch((error: unknown) => console.warn('Could not read location permission', error));
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [capture]);

  const openSettings = useCallback(async () => {
    try {
      await Linking.openSettings();
    } catch (error) {
      console.error('Could not open settings', error);
      update({ status: 'blocked', fix: null, error: 'Settings could not be opened. Open the phone Settings app → Apps → MOOZZLE → Permissions → Location.' });
    }
  }, [update]);

  return { ...state, capture, openSettings };
}
