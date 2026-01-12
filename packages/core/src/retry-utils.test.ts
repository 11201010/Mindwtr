import { describe, expect, it, vi } from 'vitest';
import { withRetry } from './retry-utils';

describe('withRetry', () => {
    it('returns on first success', async () => {
        const fn = vi.fn().mockResolvedValue('ok');
        await expect(withRetry(fn)).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries after a failure and succeeds', async () => {
        vi.useFakeTimers();
        let attempts = 0;
        const fn = vi.fn().mockImplementation(async () => {
            attempts += 1;
            if (attempts < 2) {
                throw new Error('timeout');
            }
            return 'ok';
        });

        const promise = withRetry(fn, { baseDelayMs: 50, maxDelayMs: 50 });
        await vi.advanceTimersByTimeAsync(50);
        await expect(promise).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
    });

    it('uses exponential backoff delays', async () => {
        vi.useFakeTimers();
        const delays: number[] = [];
        const fn = vi.fn().mockRejectedValue(new Error('timeout'));

        const promise = withRetry(fn, {
            maxAttempts: 3,
            baseDelayMs: 100,
            maxDelayMs: 1000,
            onRetry: (_err, _attempt, delayMs) => delays.push(delayMs),
        });

        const expectation = expect(promise).rejects.toBeDefined();
        await vi.advanceTimersByTimeAsync(300);
        await expectation;
        expect(delays).toEqual([100, 200]);
        vi.useRealTimers();
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
});
