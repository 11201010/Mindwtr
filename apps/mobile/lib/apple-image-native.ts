import { requireOptionalNativeModule, type NativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import type {
  AppleImageModelAvailability,
  AppleImageNativeBridge,
  AppleImageNativeResult,
} from './apple-image-evaluation';

interface AppleImageCaptureNativeModule extends NativeModule {
  getAvailability: () => Promise<AppleImageModelAvailability>;
  analyzeImage: (operationId: string, uri: string) => Promise<AppleImageNativeResult>;
  cancelAnalysis: (operationId: string) => Promise<void>;
}

const nativeModule = Platform.OS === 'ios'
  ? requireOptionalNativeModule<AppleImageCaptureNativeModule>('AppleImageCapture')
  : null;

export const appleImageNativeBridge: AppleImageNativeBridge = {
  async getAvailability() {
    if (!nativeModule) {
      return {
        bridgeAvailable: false,
        modelAvailable: false,
        reason: Platform.OS === 'ios' ? 'unknown' : 'unsupportedPlatform',
      };
    }
    return nativeModule.getAvailability();
  },

  async analyzeImage(operationId, uri) {
    if (!nativeModule) throw new Error('Apple image capture native bridge is unavailable');
    return nativeModule.analyzeImage(operationId, uri);
  },

  async cancelAnalysis(operationId) {
    await nativeModule?.cancelAnalysis(operationId);
  },
};
