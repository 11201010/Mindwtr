/**
 * React Native's Pomodoro card (the Focus screen's timer), replayed against the frozen
 * parity fixture (packages/core/src/pomodoro-panel-parity.fixtures.json) that core's
 * Pomodoro panel model is tested against (packages/core/src/pomodoro-panel-model.parity.test.ts).
 *
 * The fixture was captured from the card and React Native's own session controller as
 * they were before core held either (commit dba1097c7). To recapture, check that commit
 * out in its own worktree, copy this file in, and run there
 *   MINDWTR_CAPTURE_POMODORO_PANEL=1 TZ=UTC bunx vitest run components/pomodoro-panel.parity.test.tsx
 * then copy the fixture back. The capture refuses to run while any file under
 * apps/mobile or packages/core differs from the named commit (this harness and the
 * fixture aside), so the provenance always names the code that ran.
 *
 * Each scenario seeds the real store and the device's stored session, renders the
 * real card over the real controller, drives it through its own controls, and records
 * what a user sees (each text with its color, each button with its disabled flag,
 * opacity, fill and selection, the icons, the loading spinner, the folded card's
 * running dot, the open task picker and its rows), what each control asks the
 * controller for, the fold switch it stores on the device, the task it marks done,
 * and the session the card reads after each step (the fields the card draws from).
 * The controller's own writes (the stored session, task time credit) belong to the
 * controller's fixture (apps/mobile/lib/pomodoro-controller.parity.json), not this one.
 */
import React from 'react';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  flushPendingSave,
  loadTranslations,
  resetForTests,
  setStorageAdapter,
  useTaskStore,
  type AppSettings,
  type Task,
} from '@mindwtr/core';

import { PomodoroPanel } from './pomodoro-panel';
import { mobilePomodoroController } from '../lib/pomodoro-controller';

const FIXTURE_PATH = new URL('../../../packages/core/src/pomodoro-panel-parity.fixtures.json', import.meta.url).pathname;
const CAPTURE = process.env.MINDWTR_CAPTURE_POMODORO_PANEL === '1';
const FROZEN_AT = 'dba1097c7';
const NOW = '2026-10-05T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const SESSION_KEY = '@mindwtr_pomodoro_state';
const COLLAPSED_KEY = '@mindwtr_pomodoro_collapsed';

// The controller keeps the Date.now it finds when its module loads, so the clock is pinned before any import.
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-05T12:00:00.000Z'));
});

const harness = vi.hoisted(() => ({
  strings: {} as Record<string, Record<string, string>>,
  language: 'en',
  storage: new Map<string, string>(),
  hold: null as null | { promise: Promise<void>; release: () => void },
  device: [] as unknown[][],
}));

const translate = (key: string) => harness.strings[harness.language]?.[key] || harness.strings.en?.[key] || key;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => {
      if (key === '@mindwtr_pomodoro_state' && harness.hold) await harness.hold.promise;
      return harness.storage.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
      // The stored session is the controller's write, recorded by its own fixture.
      if (key !== '@mindwtr_pomodoro_state') harness.device.push(['setItem', key, value]);
      harness.storage.set(key, value);
    },
    removeItem: async (key: string) => {
      harness.device.push(['removeItem', key]);
      harness.storage.delete(key);
    },
  },
}));
vi.mock('@/contexts/language-context', () => ({
  useLanguage: () => ({ t: translate, language: harness.language, setLanguage: () => undefined, isReady: true }),
}));
vi.mock('@/hooks/use-theme-colors', () => {
  const colors = {
    bg: '#fff', cardBg: '#f8fafc', taskItemBg: '#fff', inputBg: '#fff', filterBg: '#f1f5f9', border: '#cbd5e1',
    text: '#0f172a', secondaryText: '#64748b', tint: '#3b82f6', onTint: '#fff', danger: '#ef4444', success: '#10b981', warning: '#f59e0b',
  };
  return { useThemeColors: () => colors };
});
vi.mock('@/hooks/use-filled-button-colors', () => ({
  useFilledButtonColors: () => ({ backgroundColor: '#3b82f6', textColor: undefined }),
}));
vi.mock('@/lib/app-log', () => ({
  logWarn: async (message: string) => { harness.device.push(['logWarn', message]); },
  logInfo: async () => undefined,
  logError: async () => undefined,
}));
vi.mock('lucide-react-native', () => {
  const icons = new Map<string, unknown>();
  return new Proxy({ __esModule: true } as Record<string, unknown>, {
    get: (target, prop) => {
      if (prop in target) return target[prop as string];
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      if (!icons.has(prop)) icons.set(prop, (props: any) => React.createElement(`Icon:${prop}`, props));
      return icons.get(prop);
    },
    has: (target, prop) => prop in target || (typeof prop !== 'symbol' && prop !== 'then'),
  });
});

// ---------------------------------------------------------------------------
// Scenario data.

const at = (offsetMs: number) => new Date(NOW_MS + offsetMs).toISOString();
const task = (id: string, title: string, extra: Partial<Task> = {}): Task => ({
  id, title, status: 'next', tags: [], contexts: [], createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...extra,
} as Task);

const TASKS: Task[] = [task('a', 'Write the report', { timeSpentMinutes: 30 }), task('b', 'Call Sam')];

const SETTINGS: Record<string, AppSettings> = {
  base: {},
  link: { gtd: { pomodoro: { linkTask: true } } },
  custom: { gtd: { pomodoro: { linkTask: true, customDurations: { focusMinutes: 40, breakMinutes: 8 } } } },
  autoStart: { gtd: { pomodoro: { autoStartBreaks: true, autoStartFocus: true } } },
};

const HISTORY = { totalCompletedFocusSessions: 5, todayDayKey: '2026-10-05', completedTodayFocusSessions: 2, completedFocusSessionsByTaskId: { a: 2 } };

const SESSIONS: Record<string, unknown> = {
  running: {
    durations: { focusMinutes: 25, breakMinutes: 5 }, timerState: { phase: 'focus', remainingSeconds: 1500, isRunning: true, completedFocusSessions: 2 },
    phaseEndsAt: at(10 * 60_000), sessionHistory: HISTORY, updatedAtMs: NOW_MS - 60_000,
  },
  runningLinked: {
    durations: { focusMinutes: 40, breakMinutes: 8 }, timerState: { phase: 'focus', remainingSeconds: 2400, isRunning: true, completedFocusSessions: 0 },
    phaseEndsAt: at(20 * 60_000), selectedTaskId: 'a', updatedAtMs: NOW_MS - 60_000,
  },
  pausedBreak: {
    durations: { focusMinutes: 50, breakMinutes: 10 }, timerState: { phase: 'break', remainingSeconds: 125, isRunning: false, completedFocusSessions: 1 },
    selectedTaskId: 'b', sessionHistory: HISTORY, updatedAtMs: NOW_MS - 60_000,
  },
  focusFinished: {
    durations: { focusMinutes: 25, breakMinutes: 5 }, timerState: { phase: 'focus', remainingSeconds: 10, isRunning: true, completedFocusSessions: 0 },
    phaseEndsAt: at(-1_000), selectedTaskId: 'a', updatedAtMs: NOW_MS - 60_000,
  },
  breakFinished: {
    durations: { focusMinutes: 25, breakMinutes: 5 }, timerState: { phase: 'break', remainingSeconds: 10, isRunning: true, completedFocusSessions: 1 },
    phaseEndsAt: at(-1_000), updatedAtMs: NOW_MS - 60_000,
  },
  gone: {
    durations: { focusMinutes: 25, breakMinutes: 5 }, timerState: { phase: 'focus', remainingSeconds: 1500, isRunning: false, completedFocusSessions: 0 },
    selectedTaskId: 'deleted-task', updatedAtMs: NOW_MS - 60_000,
  },
};

type Device = { language?: string; session?: string; collapsed?: string; hold?: boolean };
/**
 * Actions: ['press', label] presses a button outside the task picker (a disabled one
 * cannot be pressed); ['modalPress', label] one inside it; ['pickTask', id] a task
 * row in it; ['dismiss'] closes it; ['release'] lets the held session read finish.
 * A label is the button's spoken label or its first text; 'k:<key>' is that key's
 * translation.
 */
type Scenario = { name: string; settings: string; device: Device; pickerTasks: string[]; actions: [string, ...unknown[]][] };

const scenarios: Scenario[] = [
  {
    name: 'loading, then idle',
    settings: 'base', device: { hold: true }, pickerTasks: [],
    actions: [['press', 'k:common.start'], ['press', '50/10'], ['release']],
  },
  {
    name: 'idle: start, pause, reset, switch, presets',
    settings: 'base', device: {}, pickerTasks: [],
    actions: [
      ['press', 'k:common.start'], ['press', 'k:common.pause'], ['press', 'k:common.reset'],
      ['press', 'k:pomodoro.switchToBreak'], ['press', 'k:common.start'], ['press', 'k:pomodoro.switchToFocus'],
      ['press', '50/10'], ['press', '15/3'], ['press', '25/5'],
    ],
  },
  { name: 'running focus with history', settings: 'base', device: { session: 'running' }, pickerTasks: [], actions: [['press', 'k:common.pause'], ['press', 'k:common.start']] },
  { name: 'paused break, link off', settings: 'base', device: { session: 'pausedBreak' }, pickerTasks: ['a', 'b'], actions: [['press', 'k:pomodoro.switchToFocus']] },
  {
    name: 'finished focus: the line until reset',
    settings: 'base', device: { session: 'focusFinished' }, pickerTasks: [],
    actions: [['press', 'k:common.start'], ['press', 'k:common.reset'], ['press', 'k:common.start']],
  },
  { name: 'finished break', settings: 'base', device: { session: 'breakFinished' }, pickerTasks: [], actions: [['press', 'k:pomodoro.switchToBreak']] },
  { name: 'finished break, auto-start on', settings: 'autoStart', device: { session: 'breakFinished' }, pickerTasks: [], actions: [] },
  {
    name: 'finished focus, linked task: Task done clears the line',
    settings: 'link', device: { session: 'focusFinished' }, pickerTasks: ['a', 'b'],
    actions: [['press', 'k:pomodoro.markTaskDone']],
  },
  {
    name: 'link on: pick a task, mark it done, unlink',
    settings: 'link', device: {}, pickerTasks: ['a', 'b'],
    actions: [
      ['press', 'k:pomodoro.selectedTask'], ['dismiss'],
      ['press', 'k:pomodoro.selectedTask'], ['pickTask', 'b'],
      ['press', 'k:pomodoro.selectedTask'], ['pickTask', 'a'],
      ['press', 'k:pomodoro.markTaskDone'],
      ['press', 'k:pomodoro.selectedTask'], ['modalPress', 'k:pomodoro.timerOnly'],
    ],
  },
  {
    name: 'link on: no task to pick',
    settings: 'link', device: {}, pickerTasks: [],
    actions: [['press', 'k:pomodoro.selectedTask'], ['modalPress', 'k:pomodoro.timerOnly']],
  },
  { name: 'link on: the linked task is gone', settings: 'link', device: { session: 'gone' }, pickerTasks: ['a'], actions: [] },
  { name: 'link off keeps a stored link hidden', settings: 'base', device: { session: 'runningLinked' }, pickerTasks: ['a'], actions: [] },
  {
    name: 'custom durations, running and linked',
    settings: 'custom', device: { session: 'runningLinked', collapsed: 'false' }, pickerTasks: ['a', 'b'],
    actions: [['press', '25/5'], ['press', '40/8']],
  },
  {
    name: 'collapsed while running',
    settings: 'base', device: { session: 'running', collapsed: 'true' }, pickerTasks: [],
    actions: [['press', 'k:pomodoro.expand'], ['press', 'k:pomodoro.collapse']],
  },
  { name: 'collapsed while paused', settings: 'base', device: { session: 'pausedBreak', collapsed: 'true' }, pickerTasks: [], actions: [] },
  {
    name: 'in German, linked and paused',
    settings: 'link', device: { language: 'de', session: 'pausedBreak' }, pickerTasks: ['a', 'b'],
    actions: [['press', 'k:pomodoro.selectedTask'], ['dismiss'], ['press', 'k:pomodoro.collapse']],
  },
];

// ---------------------------------------------------------------------------
// The store, the device and the controller: real, with recorded calls.

const normalize = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_key, entry) => (
  entry === undefined ? '<undefined>' : entry
)));
const CONTROLLER_METHODS = ['ensureHydrated', 'setDurations', 'toggle', 'reset', 'switchPhase', 'setSelectedTaskId', 'clearLastEvent'] as const;
const controllerCalls: unknown[][] = [];
const markedDone: string[] = [];

async function seedStore(scenario: Scenario) {
  await flushPendingSave();
  resetForTests();
  const data = JSON.parse(JSON.stringify({ tasks: TASKS, projects: [], sections: [], areas: [], people: [], settings: SETTINGS[scenario.settings] }));
  setStorageAdapter({ getData: async () => data, saveData: async () => undefined });
  useTaskStore.setState({
    _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [], tasks: [],
    settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0, lastDataChangeAt: 0,
  } as never);
  await useTaskStore.getState().fetchData({ throwOnError: true });
  await flushPendingSave();
}

function setDevice(device: Device) {
  harness.language = device.language ?? 'en';
  harness.storage = new Map();
  if (device.session) harness.storage.set(SESSION_KEY, JSON.stringify(SESSIONS[device.session]));
  if (device.collapsed) harness.storage.set(COLLAPSED_KEY, device.collapsed);
  if (device.hold) {
    let release!: () => void;
    harness.hold = { promise: new Promise<void>((resolve) => { release = resolve; }), release: () => release() };
  } else {
    harness.hold = null;
  }
  harness.device.length = 0;
  controllerCalls.length = 0;
  markedDone.length = 0;
  mobilePomodoroController.resetForTests();
}

// ---------------------------------------------------------------------------
// Reading the rendered card. The hidden task picker renders its children in the
// test shim; it is skipped, as a user would.

const deepText = (node: ReactTestInstance | string | number | null | undefined | boolean): string => {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return node.children.map((child) => deepText(child as ReactTestInstance | string)).join('');
};

function hosts(root: ReactTestInstance, type: string, modals = false): ReactTestInstance[] {
  const out: ReactTestInstance[] = [];
  const walk = (node: ReactTestInstance) => {
    if (String(node.type) === 'Modal' && (!modals || !node.props.visible)) return;
    if (String(node.type) === type) out.push(node);
    node.children.forEach((child) => { if (typeof child !== 'string') walk(child); });
  };
  walk(root);
  return out;
}

const flatten = (style: unknown): Record<string, unknown> => (Array.isArray(style)
  ? Object.assign({}, ...style.map(flatten))
  : style && typeof style === 'object' ? style as Record<string, unknown> : {});

const textsIn = (root: ReactTestInstance, modals = false) => hosts(root, 'Text', modals).map((node) => [deepText(node), flatten(node.props.style).color ?? null]);
const words = (node: ReactTestInstance) => hosts(node, 'Text', true).map((text) => deepText(text)).join('|');
const buttonLabel = (node: ReactTestInstance) => node.props.accessibilityLabel ?? words(node);
const buttons = (root: ReactTestInstance, modals = false) => hosts(root, 'Pressable', modals).map((node) => {
  const style = flatten(node.props.style);
  return [buttonLabel(node), node.props.disabled === true, style.opacity ?? 1, style.backgroundColor ?? null, node.props.accessibilityState?.selected ?? null];
});
const visibleModal = (root: ReactTestInstance) => root.findAll((node) => String(node.type) === 'Modal' && node.props.visible === true)[0] ?? null;

/** The picker's FlatList rows (the test renderer cannot lay a FlatList out): each drawn through its renderItem. */
function pickerRows(list: ReactTestInstance) {
  const read = (element: React.ReactElement) => {
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(element); });
    const out = { texts: textsIn(renderer.root, true), buttons: buttons(renderer.root, true) };
    act(() => renderer.unmount());
    return out;
  };
  const data = list.props.data as Task[];
  if (data.length === 0) return { empty: read(list.props.ListEmptyComponent), rows: [] };
  return { empty: null, rows: data.map((item, index) => read(list.props.renderItem({ item, index }))) };
}

function observe(root: ReactTestInstance, seen: { calls: number; device: number; done: number }) {
  const modal = visibleModal(root);
  const list = modal ? hosts(modal, 'FlatList', true)[0] : null;
  const session = mobilePomodoroController.getSnapshot();
  const out = normalize({
    texts: textsIn(root),
    buttons: buttons(root),
    icons: root.findAll((node) => typeof node.type === 'string' && node.type.startsWith('Icon:')).map((node) => node.type),
    spinners: hosts(root, 'ActivityIndicator').length,
    runningDot: root.findAll((node) => typeof node.type === 'string' && node.props.importantForAccessibility === 'no-hide-descendants').length > 0,
    modal: modal ? { texts: textsIn(modal, true), buttons: buttons(modal, true), list: list ? pickerRows(list) : null } : null,
    controller: controllerCalls.slice(seen.calls),
    device: harness.device.slice(seen.device),
    markedDone: markedDone.slice(seen.done),
    session: {
      isHydrating: session.isHydrating,
      durations: session.durations,
      timerState: session.timerState,
      selectedTaskId: session.selectedTaskId,
      lastEvent: session.lastEvent,
      sessionHistory: session.sessionHistory,
    },
  });
  seen.calls = controllerCalls.length;
  seen.device = harness.device.length;
  seen.done = markedDone.length;
  return out;
}

// ---------------------------------------------------------------------------
// Driving the card.

async function run(what: string, fn: (() => unknown) | undefined) {
  if (!fn) throw new Error(`Nothing to do for ${what}`);
  await act(async () => { await fn(); });
}

const labelText = (label: string) => (label.startsWith('k:') ? translate(label.slice(2)) : label);

async function perform(renderer: ReactTestRenderer, action: [string, ...unknown[]]) {
  const root = renderer.root;
  const [kind, target] = action;
  const modal = () => visibleModal(root)!;
  switch (kind) {
    case 'press':
    case 'modalPress': {
      const scope = kind === 'press' ? hosts(root, 'Pressable') : hosts(modal(), 'Pressable', true);
      const label = labelText(target as string);
      const control = scope.find((node) => buttonLabel(node) === label || words(node).split('|')[0] === label);
      if (control?.props.disabled) return undefined;
      return run(`${kind} ${label}`, control?.props.onPress);
    }
    case 'pickTask': {
      const list = hosts(modal(), 'FlatList', true)[0];
      const index = (list.props.data as Task[]).findIndex((item) => item.id === target);
      return run('pickTask', list.props.renderItem({ item: list.props.data[index], index }).props.onPress);
    }
    case 'dismiss':
      return run('dismiss', modal().props.onRequestClose);
    case 'release':
      return run('release', () => harness.hold!.release());
    default:
      throw new Error(`Unknown action ${String(kind)}`);
  }
}

const settle = async () => {
  await act(async () => {
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    await flushPendingSave();
  });
};

async function runScenario(scenario: Scenario) {
  await seedStore(scenario);
  setDevice(scenario.device);
  const pickerTasks = scenario.pickerTasks.map((id) => TASKS.find((item) => item.id === id)!);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<PomodoroPanel tasks={pickerTasks} onMarkDone={(taskId) => { markedDone.push(taskId); }} />);
  });
  await settle();
  const seen = { calls: 0, device: 0, done: 0 };
  const observations = [observe(renderer.root, seen)];
  for (const action of scenario.actions) {
    await perform(renderer, action);
    await settle();
    observations.push(observe(renderer.root, seen));
  }
  harness.hold?.release();
  await act(async () => { renderer.unmount(); });
  await mobilePomodoroController.flushPersistence().catch(() => undefined);
  await flushPendingSave();
  return observations;
}

const inputs = () => normalize({ now: NOW, timeZone: 'UTC', tasks: TASKS, settings: SETTINGS, sessions: SESSIONS, scenarios }) as Record<string, unknown>;

function captureProvenance() {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: new URL('.', import.meta.url).pathname, encoding: 'utf8' });
  const commit = git('rev-parse', FROZEN_AT).trim();
  const top = git('rev-parse', '--show-toplevel').trim();
  const own = ['apps/mobile/components/pomodoro-panel.parity.test.tsx', 'packages/core/src/pomodoro-panel-parity.fixtures.json'];
  const changed = [
    ...git('-C', top, 'diff', '--name-only', commit, '--', 'apps/mobile', 'packages/core').split('\n'),
    ...git('-C', top, 'ls-files', '--others', '--exclude-standard', '--', 'apps/mobile', 'packages/core').split('\n'),
  ].filter((path) => path && !own.includes(path));
  if (changed.length > 0) throw new Error(`Capture needs apps/mobile and packages/core at ${FROZEN_AT}; changed: ${changed.join(', ')}`);
  return {
    command: 'cd apps/mobile && MINDWTR_CAPTURE_POMODORO_PANEL=1 TZ=UTC bunx vitest run components/pomodoro-panel.parity.test.tsx',
    capturedAt: commit,
    sourceState: `Every file under apps/mobile and packages/core was at ${FROZEN_AT} except this harness: the card and React Native's own session controller still held their policy, and core had neither a panel model nor a controller.`,
    device: 'AsyncStorage is the scenario\'s device: its stored session and fold switch, and a session read held until "release" when the scenario says hold. The clock is pinned to now.',
  };
}

describe('React Native Pomodoro card parity fixture', () => {
  const originalTz = process.env.TZ;
  const originalMethods = new Map<string, unknown>();
  beforeAll(async () => {
    (globalThis as { React?: typeof React }).React = React;
    process.env.TZ = 'UTC';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    harness.strings = { en: await loadTranslations('en'), de: await loadTranslations('de') };
    const controller = mobilePomodoroController as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const name of CONTROLLER_METHODS) {
      const real = controller[name];
      originalMethods.set(name, real);
      controller[name] = (...args: unknown[]) => {
        controllerCalls.push([name, ...(normalize(args) as unknown[])]);
        return real(...args);
      };
    }
  });
  afterAll(() => {
    const controller = mobilePomodoroController as unknown as Record<string, unknown>;
    for (const [name, real] of originalMethods) controller[name] = real;
    mobilePomodoroController.resetForTests();
    vi.useRealTimers();
    resetForTests();
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('replays every scenario exactly as frozen', async () => {
    const captured: Record<string, unknown> = {};
    for (const scenario of scenarios) captured[scenario.name] = await runScenario(scenario);
    if (process.env.MINDWTR_DUMP_POMODORO_PANEL) writeFileSync(process.env.MINDWTR_DUMP_POMODORO_PANEL, JSON.stringify(captured));
    if (CAPTURE) {
      writeFileSync(FIXTURE_PATH, `${JSON.stringify({ provenance: captureProvenance(), ...inputs(), observations: captured }, null, 1)}\n`);
    }
    const { observations, provenance: _provenance, ...frozenInputs } = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    expect(frozenInputs).toEqual(inputs());
    for (const name of Object.keys(captured)) {
      expect({ [name]: captured[name] }).toEqual({ [name]: observations[name] });
    }
    expect(Object.keys(observations)).toEqual(Object.keys(captured));
  }, 180_000);
});
