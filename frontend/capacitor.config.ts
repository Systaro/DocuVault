import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'de.systaro.docuvault',
  appName: 'DocuVault',
  webDir: 'dist/docuvault/browser',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1500,
      backgroundColor: '#0f172a',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP'
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    },
    StatusBar: {
      style: 'DARK'
    },
    Keyboard: {
      resize: 'native',
      resizeOnFullScreen: true
    }
  },
  ios: {
    contentInset: 'always'
  }
};

export default config;
