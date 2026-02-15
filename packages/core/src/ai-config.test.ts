import { describe, expect, it } from 'vitest';
import { buildAIConfig, buildCopilotConfig } from './ai-config';
import type { AppData } from './types';

const createSettings = (ai: AppData['settings']['ai']): AppData['settings'] => ({
    ai,
});

describe('ai-config endpoint mapping', () => {
    it('maps OpenAI base URL to chat completions endpoint', () => {
        const config = buildAIConfig(
            createSettings({
                provider: 'openai',
                model: 'gpt-4o-mini',
                baseUrl: 'http://localhost:11434/v1',
            }),
            'test-key',
        );
        expect(config.endpoint).toBe('http://localhost:11434/v1/chat/completions');
    });

    it('keeps chat completions endpoint unchanged', () => {
        const config = buildAIConfig(
            createSettings({
                provider: 'openai',
                model: 'gpt-4o-mini',
                baseUrl: 'http://localhost:11434/v1/chat/completions/',
            }),
            'test-key',
        );
        expect(config.endpoint).toBe('http://localhost:11434/v1/chat/completions');
    });

    it('does not set endpoint for non-openai providers', () => {
        const config = buildAIConfig(
            createSettings({
                provider: 'gemini',
                model: 'gemini-2.5-flash',
                baseUrl: 'http://localhost:11434/v1',
            }),
            'test-key',
        );
        expect(config.endpoint).toBeUndefined();
    });

    it('applies OpenAI endpoint mapping to copilot config', () => {
        const config = buildCopilotConfig(
            createSettings({
                provider: 'openai',
                copilotModel: 'gpt-4o-mini',
                baseUrl: 'http://localhost:1234/v1',
            }),
            'test-key',
        );
        expect(config.endpoint).toBe('http://localhost:1234/v1/chat/completions');
    });
});
