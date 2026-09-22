import type { CapacitorConfig } from '@capacitor/cli';

// Packaging contract only. Native projects, OAuth, signing and OTA are not configured yet.
const config: CapacitorConfig = {
  appId: 'dev.teamcampfire.geunyangmath',
  appName: '그냥수학',
  webDir: 'out',
  android: {
    allowMixedContent: false,
  },
};

export default config;
