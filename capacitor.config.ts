import type { CapacitorConfig } from '@capacitor/cli';

// Packaging contract only. Native projects, OAuth, signing and OTA are not configured yet.
const config: CapacitorConfig = {
  appId: 'dev.teamcampfire.geunyangmath',
  appName: 'geunyang math',
  webDir: 'out',
  android: {
    allowMixedContent: false,
  },
};

export default config;
