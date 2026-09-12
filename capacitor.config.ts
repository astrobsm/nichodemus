import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'org.nugoutreach.app',
  appName: 'NUG Outreach',
  webDir: 'dist',

  server: {
    // A secure context is not optional here: WebCrypto (crypto.subtle), which
    // hashes every PIN and encrypts every backup, and OPFS, which stores the
    // database, are both unavailable over plain http. https://localhost inside
    // the WebView satisfies it without any network being involved.
    androidScheme: 'https',
  },

  android: {
    // Nothing in this application uses cleartext networking - it makes no
    // network requests at all.
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
}

export default config
