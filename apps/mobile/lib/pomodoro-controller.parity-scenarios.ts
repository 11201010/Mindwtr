// Scripted sessions for the Pomodoro controller's parity fixture (packages/core/src/pomodoro-controller-parity.fixtures.json): each step's snapshot, every
// session write and every task credit. The fixture was frozen from React Native's controller before it moved into core
// (apps/mobile/lib/pomodoro-controller.ts at dba1097c7); pomodoro-controller.parity.test.ts replays it on core's.
type Controller = {
  ensureHydrated(options?: Record<string, boolean>): Promise<void>;
  reconcile(options?: Record<string, boolean>, nowMs?: number): boolean;
  setDurations(durations: { focusMinutes: number; breakMinutes: number }, options?: Record<string, boolean>): boolean;
  toggle(options?: Record<string, boolean>): boolean;
  reset(options?: Record<string, boolean>): boolean;
  switchPhase(options?: Record<string, boolean>): boolean;
  setSelectedTaskId(id: string | undefined): boolean;
  clearLastEvent(): boolean;
  applyWatchCommand(command: { action: 'start' | 'pause' | 'reset'; taskId?: string; createdAt?: string },
    options?: Record<string, boolean>, policy?: { linkTaskEnabled?: boolean }): Promise<string>;
  flushPersistence(): Promise<void>;
  getSnapshot(): Record<string, unknown>;
};

export type ControllerFactory = (options: {
  storage: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
  now: () => number;
  getTaskStore: () => { tasks: { id: string; timeSpentMinutes?: number; status: string }[]; updateTask: (id: string, updates: Record<string, unknown>) => Promise<unknown> };
}) => Controller;

export const T0 = Date.UTC(2026, 9, 5, 12, 0, 0);

type Step = { name: string; run: (c: Controller, clock: { advance(ms: number): void }) => unknown };

const SCENARIOS: { name: string; stored?: unknown; steps: Step[] }[] = [
  {
    name: 'focus with a linked task, finished, credited',
    steps: [
      { name: 'hydrate', run: (c) => c.ensureHydrated() },
      { name: 'durations 1/1', run: (c) => c.setDurations({ focusMinutes: 1, breakMinutes: 1 }) },
      { name: 'link t1', run: (c) => c.setSelectedTaskId('t1') },
      { name: 'start', run: (c) => c.toggle() },
      { name: 'tick 30 s', run: (c, clock) => { clock.advance(30_000); return c.reconcile(); } },
      { name: 'phase ends', run: (c, clock) => { clock.advance(31_000); return c.reconcile(); } },
      { name: 'idle tick', run: (c, clock) => { clock.advance(1_000); return c.reconcile(); } },
      { name: 'dismiss', run: (c) => c.clearLastEvent() },
    ],
  },
  {
    name: 'auto-start breaks and focus',
    steps: [
      { name: 'hydrate', run: (c) => c.ensureHydrated({ autoStartBreaks: true, autoStartFocus: true }) },
      { name: 'durations 1/1', run: (c) => c.setDurations({ focusMinutes: 1, breakMinutes: 1 }, { autoStartBreaks: true, autoStartFocus: true }) },
      { name: 'start', run: (c) => c.toggle({ autoStartBreaks: true, autoStartFocus: true }) },
      { name: 'focus ends', run: (c, clock) => { clock.advance(61_000); return c.reconcile({ autoStartBreaks: true, autoStartFocus: true }); } },
      { name: 'break ends', run: (c, clock) => { clock.advance(60_000); return c.reconcile({ autoStartBreaks: true, autoStartFocus: true }); } },
      { name: 'pause', run: (c) => c.toggle({ autoStartBreaks: true, autoStartFocus: true }) },
      { name: 'switch', run: (c) => c.switchPhase({ autoStartBreaks: true, autoStartFocus: true }) },
      { name: 'reset', run: (c) => c.reset({ autoStartBreaks: true, autoStartFocus: true }) },
    ],
  },
  {
    name: 'a stored running session whose phase ended while closed',
    stored: {
      durations: { focusMinutes: 25, breakMinutes: 5 },
      timerState: { phase: 'focus', remainingSeconds: 600, isRunning: true, completedFocusSessions: 2 },
      selectedTaskId: 't1',
      phaseEndsAt: new Date(T0 - 120_000).toISOString(),
      sessionHistory: { totalCompletedFocusSessions: 2, completedFocusSessionsByTaskId: { t1: 2 }, todayDayKey: '2026-10-05', completedTodayFocusSessions: 2 },
      updatedAtMs: T0 - 1_500_000,
    },
    steps: [
      { name: 'hydrate', run: (c) => c.ensureHydrated() },
      { name: 'start', run: (c) => c.toggle() },
    ],
  },
  {
    name: 'Watch commands',
    steps: [
      { name: 'hydrate', run: (c) => c.ensureHydrated() },
      { name: 'start with t2', run: (c) => c.applyWatchCommand({ action: 'start', taskId: 't2', createdAt: new Date(T0 + 1_000).toISOString() }, {}, { linkTaskEnabled: true }) },
      { name: 'replay', run: (c) => c.applyWatchCommand({ action: 'start', taskId: 't2', createdAt: new Date(T0 + 1_000).toISOString() }, {}, { linkTaskEnabled: true }) },
      { name: 'stale pause', run: (c) => c.applyWatchCommand({ action: 'pause', createdAt: new Date(T0 - 5_000).toISOString() }) },
      { name: 'pause', run: (c, clock) => { clock.advance(10_000); return c.applyWatchCommand({ action: 'pause', createdAt: new Date(T0 + 10_000).toISOString() }); } },
      { name: 'reset, link off', run: (c, clock) => { clock.advance(1_000); return c.applyWatchCommand({ action: 'reset', taskId: 't2', createdAt: new Date(T0 + 11_000).toISOString() }, {}, { linkTaskEnabled: false }); } },
      { name: 'done task skipped', run: (c, clock) => { clock.advance(1_000); return c.applyWatchCommand({ action: 'start', taskId: 't3', createdAt: new Date(T0 + 12_000).toISOString() }, {}, { linkTaskEnabled: true }); } },
    ],
  },
];

/** Runs every scenario on [create]'s controller; the record the fixture holds. */
export async function runControllerScenarios(create: ControllerFactory, setSystemTime: (ms: number) => void) {
  const out: Record<string, unknown[]> = {};
  for (const scenario of SCENARIOS) {
    let nowMs = T0;
    setSystemTime(T0);
    const stored = new Map<string, string>();
    if (scenario.stored) stored.set('@mindwtr_pomodoro_state', JSON.stringify(scenario.stored));
    const writes: unknown[] = [];
    const credits: unknown[] = [];
    const tasks = [
      { id: 't1', title: 'One', status: 'next', timeSpentMinutes: 5 },
      { id: 't2', title: 'Two', status: 'next' },
      { id: 't3', title: 'Three', status: 'done' },
    ];
    const controller = create({
      storage: {
        getItem: async (key) => stored.get(key) ?? null,
        setItem: async (key, value) => { stored.set(key, value); writes.push(JSON.parse(value)); },
      },
      now: () => nowMs,
      getTaskStore: () => ({
        tasks,
        updateTask: async (id, updates) => {
          credits.push({ id, updates });
          const task = tasks.find((candidate) => candidate.id === id);
          if (task) Object.assign(task, updates);
          return { success: true };
        },
      }),
    });
    const steps: unknown[] = [];
    for (const step of scenario.steps) {
      const result = await step.run(controller, { advance: (ms) => { nowMs += ms; setSystemTime(nowMs); } });
      await controller.flushPersistence();
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
      const { isHydrating, updatedAtMs, ...snapshot } = controller.getSnapshot();
      steps.push({ step: step.name, result: result ?? null, isHydrating, updatedAtMs, snapshot: JSON.parse(JSON.stringify(snapshot)) });
    }
    out[scenario.name] = [{ steps, writes, credits }];
  }
  return out;
}
