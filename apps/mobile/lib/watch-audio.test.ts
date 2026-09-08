import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppData } from '@mindwtr/core';

const aiConfigMocks = vi.hoisted(() => ({
  loadAIKey: vi.fn(),
}));
vi.mock('./ai-config', () => aiConfigMocks);

const speechMocks = vi.hoisted(() => ({
  processAudioCapture: vi.fn(),
  resolveSpeechToTextRuntimeSettings: vi.fn(),
}));
vi.mock('./speech-to-text', () => speechMocks);

// eslint-disable-next-line import/first
import { transcribePendingAudio, transcribePendingWatchAudio } from './watch-audio';

describe('transcribePendingAudio', () => {
  const settings = {
    ai: { provider: 'openai', model: 'gpt-test' },
  } as AppData['settings'];

  beforeEach(() => {
    vi.clearAllMocks();
    speechMocks.resolveSpeechToTextRuntimeSettings.mockReturnValue({
      enabled: true,
      provider: 'openai',
      baseUrl: undefined,
      model: 'whisper-1',
      modelPath: undefined,
      isFossBuild: false,
      language: 'en',
      mode: 'smart_parse',
      fieldStrategy: 'smart',
    });
    aiConfigMocks.loadAIKey.mockResolvedValue('secret');
    speechMocks.processAudioCapture.mockResolvedValue({ transcript: '  Captured thought  ' });
  });

  it('keeps the former Watch export as an alias', () => {
    expect(transcribePendingWatchAudio).toBe(transcribePendingAudio);
  });

  it('uses the configured speech runtime for any pending native audio and trims the transcript', async () => {
    await expect(transcribePendingAudio('file:///owned/audio.wav', settings)).resolves.toBe('Captured thought');

    expect(aiConfigMocks.loadAIKey).toHaveBeenCalledWith('openai');
    expect(speechMocks.processAudioCapture).toHaveBeenCalledWith(
      'file:///owned/audio.wav',
      expect.objectContaining({
        provider: 'openai',
        apiKey: 'secret',
        model: 'whisper-1',
        parseModel: 'gpt-test',
      }),
    );
  });

  it('returns retryable null without processing when speech-to-text is disabled', async () => {
    speechMocks.resolveSpeechToTextRuntimeSettings.mockReturnValue({ enabled: false });

    await expect(transcribePendingAudio('file:///owned/audio.wav', settings)).resolves.toBeNull();
    expect(aiConfigMocks.loadAIKey).not.toHaveBeenCalled();
    expect(speechMocks.processAudioCapture).not.toHaveBeenCalled();
  });

  it('does not create a task from the local Whisper silence marker', async () => {
    speechMocks.resolveSpeechToTextRuntimeSettings.mockReturnValue({ enabled: true, provider: 'whisper' });
    speechMocks.processAudioCapture.mockResolvedValue({ transcript: ' [BLANK_AUDIO] ' });
    await expect(transcribePendingAudio('file:///owned/audio.wav', settings)).resolves.toBeNull();
    expect(aiConfigMocks.loadAIKey).not.toHaveBeenCalled();
  });
});
