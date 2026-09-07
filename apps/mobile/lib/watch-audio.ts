import type { AppData } from '@mindwtr/core';

import { loadAIKey } from './ai-config';
import {
  processAudioCapture,
  resolveSpeechToTextRuntimeSettings,
  type SpeechToTextConfig,
} from './speech-to-text';

/**
 * Runs a Watch WAV through the same configured phone transcription service as
 * Quick Capture. A null result is retryable: the queue and WAV must stay put.
 */
export async function transcribePendingWatchAudio(
  audioPath: string,
  settings: AppData['settings'],
): Promise<string | null> {
  const runtime = resolveSpeechToTextRuntimeSettings(settings.ai?.speechToText);
  if (!runtime.enabled) return null;
  const apiKey = runtime.provider === 'whisper'
    ? ''
    : await loadAIKey(runtime.provider).catch(() => '');
  if (runtime.provider !== 'whisper' && !apiKey && !runtime.baseUrl) return null;

  const timeZone = typeof Intl === 'object' && typeof Intl.DateTimeFormat === 'function'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : undefined;
  const result = await processAudioCapture(audioPath, {
    provider: runtime.provider,
    apiKey,
    baseUrl: runtime.baseUrl,
    model: runtime.model,
    modelPath: runtime.modelPath,
    isFossBuild: runtime.isFossBuild,
    language: runtime.language,
    mode: runtime.mode,
    fieldStrategy: runtime.fieldStrategy,
    parseModel: runtime.provider === 'openai' && settings.ai?.provider === 'openai'
      ? settings.ai.model
      : undefined,
    now: new Date(),
    timeZone,
  } satisfies SpeechToTextConfig);
  const transcript = result.transcript?.trim();
  return transcript || null;
}
