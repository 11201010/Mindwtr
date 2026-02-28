import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSyncOrchestrator } from './sync-orchestrator';

describe('mobile sync orchestrator', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('re-runs a queued cycle after the in-flight cycle completes', async () => {
        const calls: number[] = [];
        const orchestrator = createSyncOrchestrator<string | undefined, number>({
            runCycle: async (arg) => {
                calls.push(calls.length + 1);
                if (arg === 'initial') {
                    await new Promise((resolve) => setTimeout(resolve, 30));
                }
                return calls.length;
            },
        });

        const first = orchestrator.run('initial');
        const second = orchestrator.run('queued');

        const [firstResult, secondResult] = await Promise.all([first, second]);
        expect(firstResult).toBe(1);
        expect(secondResult).toBe(1);

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(calls).toHaveLength(2);
    });

    it('uses the latest queued argument for follow-up runs', async () => {
        const args: Array<string | undefined> = [];
        const orchestrator = createSyncOrchestrator<string | undefined, string>({
            runCycle: async (arg) => {
                args.push(arg);
                if (args.length === 1) {
                    await new Promise((resolve) => setTimeout(resolve, 25));
                }
                return arg ?? 'none';
            },
        });

        const first = orchestrator.run('first');
        const second = orchestrator.run('second');
        const third = orchestrator.run('third');

        await Promise.all([first, second, third]);
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(args).toEqual(['first', 'third']);
    });

    it('supports requesting follow-up from inside a running cycle', async () => {
        let calls = 0;
        const orchestrator = createSyncOrchestrator<string | undefined, number>({
            runCycle: async (_arg, { requestFollowUp }) => {
                calls += 1;
                if (calls === 1) {
                    requestFollowUp();
                    await new Promise((resolve) => setTimeout(resolve, 10));
                }
                return calls;
            },
        });

        const result = await orchestrator.run(undefined);
        expect(result).toBe(1);

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(calls).toBe(2);
    });
});
