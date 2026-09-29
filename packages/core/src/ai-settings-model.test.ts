import { describe, expect, it, vi } from 'vitest';

import { createAIKeyStore } from './ai-config';
import {
    getAIProviderDefaultsPatch,
    getFossSpeechCorrection,
    getSpeechModelListKind,
    readAIProviderConsent,
    recordAIProviderConsent,
    resolveAISettingsScreenState,
} from './ai-settings-model';
import { createSyncSecretVault } from './sync-secret-storage';

const memoryStorage = (entries: Record<string, string> = {}) => {
    const items = new Map(Object.entries(entries));
    return {
        items,
        getItem: async (key: string) => items.get(key) ?? null,
        setItem: async (key: string, value: string) => { items.set(key, value); },
        removeItem: async (key: string) => { items.delete(key); },
    };
};

describe('AI keys (createAIKeyStore)', () => {
    const keystore = (available: boolean) => {
        const items = new Map<string, string>();
        const writes: unknown[][] = [];
        return {
            items,
            writes,
            port: {
                isAvailable: async () => available,
                getItem: async (key: string) => items.get(key) ?? null,
                setItem: async (key: string, value: string, accessibility: string) => { writes.push([key, accessibility]); items.set(key, value); },
                deleteItem: async (key: string) => { items.delete(key); },
            },
        };
    };

    it('moves a legacy plaintext key into the keystore, readable when unlocked, and clears the plaintext', async () => {
        const storage = memoryStorage({ 'mindwtr-ai-key:openai': 'sk-legacy-1' });
        const secure = keystore(true);
        const store = createAIKeyStore({ storage, secrets: secure.port, vault: createSyncSecretVault(secure.port) });
        await expect(store.load('openai')).resolves.toBe('sk-legacy-1');
        expect(secure.items.get('mindwtr-ai-key_openai')).toBe('sk-legacy-1');
        expect(secure.writes).toEqual([['mindwtr-ai-key_openai', 'when-unlocked']]);
        expect(storage.items.size).toBe(0);
        await store.save('openai', '');
        expect(secure.items.size).toBe(0);
    });

    it('keeps a key in memory only when the keystore is unsupported', async () => {
        const storage = memoryStorage();
        const secure = keystore(false);
        const store = createAIKeyStore({ storage, secrets: secure.port, vault: createSyncSecretVault(secure.port) });
        await store.save('gemini', 'session-key');
        expect(storage.items.size).toBe(0);
        expect(secure.items.size).toBe(0);
        await expect(store.load('gemini')).resolves.toBe('session-key');
    });
});

describe('AI provider consent record', () => {
    it('reads only true entries, and an unreadable record as none (warned once per read)', async () => {
        const warn = vi.fn();
        expect(await readAIProviderConsent(memoryStorage({ 'mindwtr-ai-provider-consent-v1': '{"openai":true,"gemini":"yes"}' }), warn))
            .toEqual({ openai: true, gemini: false });
        expect(await readAIProviderConsent(memoryStorage({ 'mindwtr-ai-provider-consent-v1': 'not json' }), warn)).toEqual({});
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('adds a provider to the record', async () => {
        const storage = memoryStorage({ 'mindwtr-ai-provider-consent-v1': '{"openai":true}' });
        await recordAIProviderConsent(storage, 'anthropic', vi.fn());
        expect(JSON.parse(storage.items.get('mindwtr-ai-provider-consent-v1')!)).toEqual({ openai: true, anthropic: true });
    });
});

describe('AI settings screen rules', () => {
    it('shows a FOSS build its local provider and Whisper whatever is stored', () => {
        const state = resolveAISettingsScreenState({ ai: { provider: 'gemini', speechToText: { provider: 'openai' } } }, true);
        expect(state.aiProvider).toBe('openai');
        expect(state.aiModel).toBe('llama3.2');
        expect(state.speechProvider).toBe('whisper');
        expect(getFossSpeechCorrection({ provider: 'openai' }, true)).toEqual({ provider: 'whisper', model: 'whisper-tiny' });
        expect(getFossSpeechCorrection({ provider: 'whisper', model: 'whisper-base' }, true)).toBeNull();
    });

    it('gives a provider its defaults', () => {
        expect(getAIProviderDefaultsPatch('anthropic', false)).toEqual({
            provider: 'anthropic', model: 'claude-sonnet-5', copilotModel: 'claude-haiku-4-5', reasoningEffort: 'low', thinkingBudget: 0,
        });
    });

    it('asks a speech provider for its models only with a key, or an OpenAI base URL', () => {
        expect(getSpeechModelListKind({ provider: 'whisper', apiKey: 'k', baseUrl: '' })).toBeNull();
        expect(getSpeechModelListKind({ provider: 'gemini', apiKey: '', baseUrl: 'http://x' })).toBeNull();
        expect(getSpeechModelListKind({ provider: 'openai', apiKey: '', baseUrl: 'http://x' })).toBe('transcription');
        expect(getSpeechModelListKind({ provider: 'gemini', apiKey: 'k', baseUrl: '' })).toBe('chat');
    });
});
