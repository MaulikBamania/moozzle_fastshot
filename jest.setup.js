// RNTL includes matchers compatible with the template's React version.
require('@testing-library/react-native');

// Worklets 0.10 supplies the native boundary used by Reanimated 4's Jest mock.
// Use its supported mock rather than initializing the unavailable native runtime.
jest.mock('react-native-worklets', () =>
  require('react-native-worklets/lib/module/mock')
);

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
