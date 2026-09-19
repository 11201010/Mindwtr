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

    it('leaves ordinary words that contain "sk-" alone', () => {
        expect(sanitizeForLog('task-management-system and risk-assessment-notes'))
            .toBe('task-management-system and risk-assessment-notes');
    });
});
