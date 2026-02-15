import { describe, expect, it, vi } from 'vitest';
import { withRetry } from './retry-utils';

describe('withRetry', () => {
    it('returns on first success', async () => {
        const fn = vi.fn().mockResolvedValue('ok');
        await expect(withRetry(fn)).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries after a failure and succeeds', async () => {
        let attempts = 0;
        const fn = vi.fn().mockImplementation(async () => {
            attempts += 1;
            if (attempts < 2) {
                throw new Error('timeout');
            }
            return 'ok';
        });

        const promise = withRetry(fn, { baseDelayMs: 1, maxDelayMs: 1 });
        await expect(promise).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('uses exponential backoff delays', async () => {
        const delays: number[] = [];
        const fn = vi.fn().mockRejectedValue(new Error('timeout'));

        const promise = withRetry(fn, {
            maxAttempts: 3,
            baseDelayMs: 1,
            maxDelayMs: 4,
            jitterRatio: 0,
            onRetry: (_err, _attempt, delayMs) => delays.push(delayMs),
        });

        await expect(promise).rejects.toBeDefined();
        expect(delays).toEqual([1, 2]);
    });

    it('stops after max attempts', async () => {
        let attempts = 0;
        const fn = vi.fn().mockImplementation(async () => {
            attempts += 1;
            throw new Error('timeout');
        });
        await expect(withRetry(fn, { maxAttempts: 2, baseDelayMs: 0 })).rejects.toBeDefined();
        expect(attempts).toBe(2);
    });

    it('does not retry non-retryable errors', async () => {
        const error = Object.assign(new Error('Not found'), { status: 404 });
        const fn = vi.fn().mockRejectedValue(error);
        await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 0 })).rejects.toBe(error);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('applies jitter to exponential delay when enabled', async () => {
        const delays: number[] = [];
        const fn = vi.fn().mockRejectedValue(new Error('timeout'));

        await expect(withRetry(fn, {
            maxAttempts: 2,
            baseDelayMs: 10,
            maxDelayMs: 100,
            jitterRatio: 0.5,
            random: () => 1, // max positive jitter
            onRetry: (_err, _attempt, delayMs) => delays.push(delayMs),
        })).rejects.toBeDefined();

        expect(delays).toHaveLength(1);
        expect(delays[0]).toBe(15);
    });
});
