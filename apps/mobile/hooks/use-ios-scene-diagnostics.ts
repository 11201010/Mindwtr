import { useEffect } from 'react';

import { logInfo } from '@/lib/app-log';
import {
  drainIosSceneDiagnostics,
  subscribeIosSceneDiagnostics,
} from '@/modules/ios-scene-lifecycle';

export function useIosSceneDiagnostics(): void {
  useEffect(() => {
    const drain = () => {
      for (const record of drainIosSceneDiagnostics()) {
        void logInfo('iOS scene lifecycle event', {
          scope: 'ios-scene-lifecycle',
          extra: {
            releaseCheck: 'v1.3.1/ios-scene-lifecycle',
            stage: record.stage,
            deliveryKind: record.deliveryKind,
            count: record.count,
          },
        });
      }
    };

    const subscription = subscribeIosSceneDiagnostics(drain);
    drain();
    return () => subscription.remove();
  }, []);
}
