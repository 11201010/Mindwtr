import { describe, expect, it, vi } from 'vitest';
import { createAIProvider } from '../ai-service';
import type { AIProviderId } from '../types';

const answer = JSON.stringify({ question: 'Was ist der nächste Schritt?', options: [{ label: 'Anrufen', action: 'Call' }] });

const responseFor = (provider: AIProviderId) => new Response(JSON.stringify(
    provider === 'openai'
        ? { choices: [{ message: { content: answer } }] }
        : provider === 'gemini'
            ? { candidates: [{ content: { parts: [{ text: answer }] } }] }
            : { content: [{ type: 'text', text: answer }] },
), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('AI provider request language', () => {
    it.each<AIProviderId>(['openai', 'gemini', 'anthropic'])('%s sends the app language in its request', async (provider) => {
        const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => responseFor(provider));
        const ai = createAIProvider({
            provider,
            apiKey: 'test-key',
            model: provider === 'openai' ? 'gpt-4o-mini' : provider === 'gemini' ? 'gemini-2.5-flash' : 'claude-haiku-4-5-20251001',
            language: 'de',
            fetcher: fetcher as unknown as typeof fetch,
        });

        await ai.clarifyTask({ title: 'Call the clinic', contexts: ['@phone'] });

        const body = JSON.parse(String((fetcher.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, any>;
        const system = provider === 'openai' ? body.messages[0].content
            : provider === 'gemini' ? body.contents[0].parts[0].text : body.system;
        const user = provider === 'openai' ? body.messages[1].content
            : provider === 'gemini' ? body.contents[0].parts[0].text : body.messages[0].content;
        expect(system).toContain('in Deutsch (app language: de)');
        expect(system).toContain('Always output valid JSON');
        expect(system).toContain('existing context and tag candidates exactly as supplied');
        expect(user).toContain('"question": string');
        expect(user).toContain('Call the clinic');
        expect(user).toContain('@phone');
    });
});
