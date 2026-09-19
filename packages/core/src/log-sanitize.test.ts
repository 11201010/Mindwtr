import { describe, expect, it } from 'vitest';
import { sanitizeForLog, sanitizeLogContext, sanitizeUrl } from './log-sanitize';

describe('log sanitization', () => {
    it('redacts credentials in plain text', () => {
        expect(sanitizeForLog('Authorization: Bearer secret-token')).toContain('[redacted]');
        expect(sanitizeForLog('password=hunter2')).toContain('password=[redacted]');
    });

    it('redacts private content fields in structured context', () => {
        expect(sanitizeLogContext({
            title: 'Private task title',
            description: 'Very private note',
            projectId: 'project-123',
        })).toEqual({
            title: '[redacted]',
            description: '[redacted]',
            projectId: 'project-123',
        });
    });

    it('redacts ICS urls and query secrets', () => {
        expect(sanitizeUrl('webcal://example.com/calendar.ics')).toBe('[redacted-ics-url]');
        expect(sanitizeUrl('https://example.com/sync?token=secret&ok=1')).toBe('https://example.com/sync?token=redacted&ok=1');
    });

    // Made-up strings in the public shape of each provider's key. Never a real key.
    const FAKE_KEYS: Array<[string, string]> = [
        ['openai legacy', `sk-${'A'.repeat(48)}`],
        ['openai project', `sk-proj-${'Ab1_'.repeat(6)}-${'Cd2'.repeat(10)}`],
        ['anthropic', `sk-ant-api03-${'Ef3-'.repeat(5)}${'Gh4_'.repeat(10)}`],
        ['openrouter', `sk-or-v1-${'e'.repeat(64)}`],
        ['xai', `xai-${'C'.repeat(40)}`],
        ['groq', `gsk_${'D'.repeat(40)}`],
        ['gemini', `AIza${'B'.repeat(35)}`],
    ];

    it.each(FAKE_KEYS)('redacts a %s key in free text and in context values', (_name, key) => {
        const text = sanitizeForLog(`Request failed: 401 Incorrect API key provided: ${key}.`);
        expect(text).not.toContain(key.slice(-12));
        expect(text).toContain('[redacted]');
        const context = JSON.stringify(sanitizeLogContext({ detail: `bad ${key}` }));
        expect(context).not.toContain(key.slice(-12));
    });

    // The character to the left of a key in a log line is rarely a space: it is
    // an env-var name, a percent escape or an `=`. Only a LETTER before the
    // prefix means this is an ordinary word rather than a key.
    const KEY_CONTEXTS: Array<[string, (key: string) => string]> = [
        ['an env var name', (key) => `OPENAI_${key}`],
        ['a percent escape', (key) => `q=%20${key}`],
        ['an assignment', (key) => `key=${key}`],
        ['a digit', (key) => `attempt2${key}`],
        ['the start of the text', (key) => key],
    ];

    it.each(KEY_CONTEXTS)('redacts every key shape that follows %s', (_name, wrap) => {
        for (const [provider, key] of FAKE_KEYS) {
            const text = sanitizeForLog(wrap(key));
            expect(text, `free text after ${provider}`).not.toContain(key.slice(-12));
            const context = JSON.stringify(sanitizeLogContext({ detail: wrap(key) }));
            expect(context, `context value after ${provider}`).not.toContain(key.slice(-12));
        }
    });

    it('leaves ordinary words that contain "sk-" alone', () => {
        expect(sanitizeForLog('task-management-system and risk-assessment-notes'))
            .toBe('task-management-system and risk-assessment-notes');
        // Same words at the very start of the text, where `^` also applies.
        expect(sanitizeForLog('risk-assessment-notes only')).toBe('risk-assessment-notes only');
    });

    it('keeps the character before a redacted key', () => {
        expect(sanitizeForLog(`OPENAI_${FAKE_KEYS[0][1]}`)).toBe('OPENAI_[redacted]');
        expect(sanitizeForLog(`${FAKE_KEYS[0][1]} trailing`)).toBe('[redacted] trailing');
    });
});
