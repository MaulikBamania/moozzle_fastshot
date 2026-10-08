// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    files: ['serve-expo.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { __dirname: 'readonly', Buffer: 'readonly' },
    },
  },
  {
    // Guard against the Zustand v5 footgun: a selector that returns a freshly
    // built reference on every call makes useSyncExternalStore loop forever
    // ("Maximum update depth exceeded"). Heuristic — select raw state and
    // derive with useMemo, or read imperatively via getState().
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.name=/Store$/] > ArrowFunctionExpression > ArrayExpression',
          message:
            'Zustand selector returns a NEW array every render -> infinite re-render. Select raw state and derive with useMemo.',
        },
        {
          selector:
            'CallExpression[callee.name=/Store$/] > ArrowFunctionExpression > ObjectExpression',
          message:
            'Zustand selector returns a NEW object every render -> infinite re-render. Select fields individually or wrap with useShallow.',
        },
        {
          selector:
            'CallExpression[callee.name=/Store$/] > ArrowFunctionExpression > CallExpression[callee.property.name=/^(get[A-Z].*|map|filter|slice|sort|concat|flatMap|reverse|splice)$/]',
          message:
            'Zustand selector calls a method that allocates a new value each render -> infinite re-render. Select raw state and derive with useMemo, or call it via useAppStore.getState().',
        },
        {
          // Hermes ships toReversed, toSpliced and with, but NOT toSorted.
          // Measured on Expo SDK 54 / RN 0.81, Hermes bytecode v96.
          selector: 'CallExpression[callee.property.name="toSorted"]',
          message:
            'Array.prototype.toSorted does not exist in Hermes -> TypeError in a release build. Use [...arr].sort().',
        },
      ],
    },
  },
  {
    // APIs that exist in a browser (and in the web preview, and under the dev
    // debugger) but NOT in the Hermes engine a release build runs on. Calling
    // one throws TypeError only in the shipped app, which is how a live
    // customer app ended up with a completely dead button: console.time threw
    // before the network call, and the copy of it at the top of the catch
    // block threw again, so the Alert in that catch never ran (FST-315).
    //
    // Measured inside a release build on Expo SDK 54 / RN 0.81, Hermes
    // bytecode v96. window, alert, navigator, process.env, structuredClone,
    // queueMicrotask, Object.hasOwn, Promise.allSettled/any, Array.at/findLast
    // and Intl.DateTimeFormat/NumberFormat DO exist — do not add them here.
    files: ['**/*.{js,jsx,ts,tsx}'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'console', property: 'time', message: 'console.time does not exist in Hermes -> TypeError in a release build. Use performance.now().' },
        { object: 'console', property: 'timeEnd', message: 'console.timeEnd does not exist in Hermes -> TypeError in a release build. Use performance.now().' },
        { object: 'console', property: 'count', message: 'console.count does not exist in Hermes -> TypeError in a release build.' },
        { object: 'console', property: 'dir', message: 'console.dir does not exist in Hermes -> TypeError in a release build. Use console.log.' },
        { object: 'console', property: 'profile', message: 'console.profile does not exist in Hermes -> TypeError in a release build.' },
        { object: 'Object', property: 'groupBy', message: 'Object.groupBy does not exist in Hermes -> TypeError in a release build. Use reduce().' },
        { object: 'Intl', property: 'RelativeTimeFormat', message: 'Intl.RelativeTimeFormat does not exist in Hermes -> TypeError in a release build.' },
        { object: 'Intl', property: 'Segmenter', message: 'Intl.Segmenter does not exist in Hermes -> TypeError in a release build.' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'No localStorage in React Native. Use @react-native-async-storage/async-storage.' },
        { name: 'sessionStorage', message: 'No sessionStorage in React Native. Use AsyncStorage.' },
        { name: 'indexedDB', message: 'No indexedDB in React Native. Use AsyncStorage or expo-sqlite.' },
        { name: 'document', message: 'There is no DOM in React Native.' },
        { name: 'confirm', message: 'confirm() does not exist in Hermes. Use Alert.alert with two buttons.' },
        { name: 'prompt', message: 'prompt() does not exist in Hermes. Use a TextInput in a Modal.' },
        { name: 'crypto', message: 'There is no global crypto in Hermes. Use expo-crypto.' },
        { name: 'Worker', message: 'Web Workers do not exist in React Native.' },
        { name: 'SharedArrayBuffer', message: 'SharedArrayBuffer does not exist in Hermes.' },
        { name: 'FinalizationRegistry', message: 'FinalizationRegistry does not exist in Hermes.' },
      ],
    },
  },
  {
    // React Three Fiber has its own intrinsic elements. Keep DOM attribute
    // validation, and accept these renderer properties only on their elements.
    files: ['examples/with-react-three-fiber/App.js'],
    rules: {
      'react/no-unknown-property': ['error', { ignore: ['attach', 'args', 'position'] }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXOpeningElement[name.name=/^[a-z]/][name.name!=/^(boxBufferGeometry|meshStandardMaterial)$/] > JSXAttribute[name.name="attach"]',
          message: 'The attach property belongs to Three geometry and material elements.',
        },
        {
          selector: 'JSXOpeningElement[name.name=/^[a-z]/][name.name!="boxBufferGeometry"] > JSXAttribute[name.name="args"]',
          message: 'The args property belongs to the Three geometry constructor.',
        },
        {
          selector: 'JSXOpeningElement[name.name=/^[a-z]/][name.name!=/^(mesh|pointLight)$/] > JSXAttribute[name.name="position"]',
          message: 'The position property belongs to Three scene objects.',
        },
      ],
    },
  },
]);
