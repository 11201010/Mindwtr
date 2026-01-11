import { useEffect, useRef } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTaskStore } from '@mindwtr/core';

import { useQuickCapture } from '../../../contexts/quick-capture-context';

export default function CaptureQuickScreen() {
  const { openQuickCapture } = useQuickCapture();
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; autoRecord?: string }>();
  const { settings } = useTaskStore();
  const openedRef = useRef(false);

  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;

    const defaultCapture = settings.gtd?.defaultCaptureMethod ?? 'audio';
    const mode = typeof params.mode === 'string' ? params.mode : undefined;
    const autoParam = typeof params.autoRecord === 'string' ? params.autoRecord : undefined;
    const autoRecord = mode
      ? mode === 'audio'
      : autoParam
        ? autoParam === '1' || autoParam.toLowerCase() === 'true'
        : defaultCapture === 'audio';

    openQuickCapture({ autoRecord });
    router.replace('/inbox');
  }, [openQuickCapture, params.autoRecord, params.mode, router, settings.gtd?.defaultCaptureMethod]);

  return null;
}
