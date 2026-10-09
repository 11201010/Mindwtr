/**
 * React Native's Pomodoro controller, replayed against the parity fixture frozen from RN's own controller before it moved
 * into core (packages/core/src/pomodoro-controller-parity.fixtures.json; its provenance names the commit). RN's
 * controller is now core's (packages/core/src/pomodoro-controller.ts) with RN's storage, task store and log, and the
 * native host runs the same core controller: each scripted step's snapshot, every session write and every task credit
 * must match what RN's own controller did.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.TZ = 'UTC';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 9, 5, 12, 0, 0));
});
vi.mock('./app-log', () => ({ logWarn: vi.fn(async () => undefined) }));
vi.mock('@/lib/workspace-session-storage', () => ({ workspaceSessionStorage: { getItem: async () => null, setItem: async () => undefined } }));

// eslint-disable-next-line import/first
import { createMobilePomodoroController } from './pomodoro-controller';
// eslint-disable-next-line import/first
import { runControllerScenarios } from './pomodoro-controller.parity-scenarios';

const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../../packages/core/src/pomodoro-controller-parity.fixtures.json'), 'utf8')) as {
  scenarios: Record<string, unknown>;
};

it('replays RN\'s frozen controller sessions on core\'s controller', async () => {
  const out = await runControllerScenarios((options) => createMobilePomodoroController(options as never) as never, (ms) => vi.setSystemTime(ms));
  expect(out).toEqual(fixture.scenarios);
});
