/**
 * React Native's Focus checklist page (check-focus), replayed against the frozen
 * parity fixture (packages/core/src/focus-checklist-parity.fixtures.json) that
 * core's focus-checklist-model and the native host contract are tested against.
 *
 * The fixture's `provenance` names the commit it was captured at. To recapture,
 * commit every other change first, then run
 *   MINDWTR_CAPTURE_FOCUS_CHECKLIST=1 MINDWTR_CAPTURE_FOCUS_CHECKLIST_COMMIT=$(git rev-parse HEAD) TZ=UTC bunx vitest run app/check-focus.parity.test.tsx
 * The capture refuses to run unless that commit is HEAD and the checkout holds
 * nothing but HEAD's code and these parity harnesses. Each scenario renders the
 * real page with the real core store, ticks, types, deletes and adds items, and
 * records what a user sees and what the store is asked to write.
 */
import React from 'react';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { flushPendingSave, loadTranslations, resetForTests, setStorageAdapter, useTaskStore, type Task } from '@mindwtr/core';

import FocusChecklistPage from './check-focus';

const FIXTURE_PATH = new URL('../../../packages/core/src/focus-checklist-parity.fixtures.json', import.meta.url).pathname;
const CAPTURE = process.env.MINDWTR_CAPTURE_FOCUS_CHECKLIST === '1';

const harness = vi.hoisted(() => ({
  strings: {} as Record<string, string>,
  id: 't-trip' as string | string[],
  uuid: 0,
  navigation: [] as unknown[][],
  toasts: [] as { tone?: string; title?: string; message?: string; durationMs?: number }[],
}));

vi.mock('@mindwtr/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mindwtr/core')>();
  return { ...actual, generateUUID: () => `uuid-${++harness.uuid}` };
});
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: harness.id }),
  useRouter: () => ({ back: () => { harness.navigation.push(['back']); } }),
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: any) => React.createElement('SafeAreaView', props, props.children),
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: (props: any) => React.createElement('Ionicons', props) }));
vi.mock('lucide-react-native', () => ({
  Check: (props: any) => React.createElement('Icon:Check', props),
  Plus: (props: any) => React.createElement('Icon:Plus', props),
  Trash2: (props: any) => React.createElement('Icon:Trash2', props),
}));
vi.mock('../hooks/use-theme-colors', () => {
  const colors = {
    bg: '#fff', cardBg: '#f8fafc', inputBg: '#fff', border: '#cbd5e1',
    text: '#0f172a', secondaryText: '#64748b', tint: '#3b82f6', onTint: '#fff', danger: '#ef4444',
  };
  return { useThemeColors: () => colors };
});
vi.mock('../contexts/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => harness.strings[key] ?? key, language: 'en' }),
}));
vi.mock('../contexts/toast-context', () => ({
  useToast: () => ({ showToast: (toast: (typeof harness.toasts)[number]) => { harness.toasts.push(toast); } }),
}));

export const NOW = '2026-09-27T14:00:00.000Z';
const TINT = '#3b82f6';
const SECONDARY = '#64748b';
const at = (day: string) => `2026-09-${day}T12:00:00.000Z`;
const task = (id: string, title: string, extra: Partial<Task> = {}): Task => ({
  id, title, status: 'next', contexts: [], tags: [], createdAt: at('10'), updatedAt: at('10'), ...extra,
});

const tasks: Task[] = [
  task('t-trip', 'Pack for trip', {
    checklist: [
      { id: 'c-passport', title: 'Passport', isCompleted: false },
      { id: 'c-chargers', title: 'Chargers', isCompleted: true },
      { id: 'c-blank', title: '   ', isCompleted: false },
    ],
  }),
  task('t-empty', 'Empty list'),
  task('t-list', 'Groceries', {
    taskMode: 'list',
    checklist: [
      { id: 'c-eggs', title: 'Eggs', isCompleted: true },
      { id: 'c-bread', title: 'Bread', isCompleted: false },
    ],
  }),
  task('t-archived', 'Old trip', { status: 'archived', completedAt: at('11'), checklist: [{ id: 'c-old', title: 'Tickets', isCompleted: true }] }),
  task('t-deleted', 'Gone trip', { deletedAt: at('11'), checklist: [{ id: 'c-gone', title: 'Map', isCompleted: false }] }),
];

type Action =
  | ['toggle' | 'remove', number]
  | ['rename', number, string]
  | ['add' | 'back']
  | ['fail', 'refuse' | 'refuseSilent' | 'throw'];
type Scenario = { name: string; id: string | string[]; actions: Action[] };

export const scenarios: Scenario[] = [
  {
    name: 'tick, rename, delete and add',
    id: 't-trip',
    actions: [
      ['toggle', 0],
      ['toggle', 0],
      ['rename', 1, 'Phone chargers'],
      ['rename', 1, 'Phone chargers\nand cables'],
      ['remove', 2],
      ['add'],
      ['add'],
      ['rename', 2, 'Snacks'],
      ['toggle', 1],
      ['back'],
    ],
  },
  { name: 'an empty checklist', id: 't-empty', actions: [['add'], ['rename', 0, 'First'], ['toggle', 0], ['remove', 0]] },
  { name: 'a list task', id: 't-list', actions: [['toggle', 1], ['toggle', 0]] },
  { name: 'an archived task', id: 't-archived', actions: [] },
  { name: 'a deleted task', id: 't-deleted', actions: [] },
  { name: 'an unknown task', id: 't-missing', actions: [] },
  { name: 'the first of several ids', id: ['t-list', 't-trip'], actions: [['toggle', 0]] },
  {
    name: 'a refused or failed write rolls back',
    id: 't-trip',
    actions: [
      ['fail', 'refuse'],
      ['toggle', 0],
      ['fail', 'throw'],
      ['rename', 0, 'Visa'],
      ['fail', 'refuseSilent'],
      ['add'],
      ['toggle', 0],
    ],
  },
];

const writeLog: unknown[][] = [];
let failure: 'refuse' | 'refuseSilent' | 'throw' | null = null;
let realUpdateTask: ((...args: any[]) => Promise<unknown>) | null = null;
const normalize = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_key, entry) => (
  entry === undefined ? '<undefined>' : entry
)));

async function seedStore() {
  await flushPendingSave();
  resetForTests();
  realUpdateTask ??= useTaskStore.getState().updateTask as unknown as (...args: any[]) => Promise<unknown>;
  const real = realUpdateTask;
  const data = JSON.parse(JSON.stringify({ tasks, projects: [], sections: [], areas: [], people: [], settings: {} }));
  setStorageAdapter({ getData: async () => data, saveData: async () => undefined });
  useTaskStore.setState({
    updateTask: real,
    _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
    settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0, lastDataChangeAt: 0,
  } as never);
  await useTaskStore.getState().fetchData({ throwOnError: true });
  await flushPendingSave();
  useTaskStore.setState({
    updateTask: async (...args: unknown[]) => {
      writeLog.push(['updateTask', ...(normalize(args) as unknown[])]);
      const mode = failure;
      failure = null;
      if (mode === 'refuse') return { success: false, error: 'disk full' };
      if (mode === 'refuseSilent') return { success: false };
      if (mode === 'throw') throw new Error('disk unavailable');
      return real(...args);
    },
  } as never);
}

const textOf = (node: ReactTestInstance): string => {
  const children = node.props?.children;
  const list = Array.isArray(children) ? children.flat(Infinity) : [children];
  return list.filter((child) => typeof child === 'string' || typeof child === 'number').map(String).join('');
};
const flatten = (style: unknown): Record<string, unknown> => (
  Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style && typeof style === 'object' ? style as Record<string, unknown> : {}
);
const hostsOf = (root: ReactTestInstance, type: string) => root.findAll((node) => String(node.type) === type);

function observe(root: ReactTestInstance, seen: { writes: number; toasts: number; navigation: number }) {
  const observation = {
    texts: hostsOf(root, 'Text').map(textOf),
    buttons: hostsOf(root, 'TouchableOpacity').map((node) => [
      node.props.accessibilityRole ?? null,
      node.props.accessibilityLabel ?? null,
      node.props.accessibilityState ?? null,
      flatten(node.props.style).backgroundColor === TINT,
      hostsOf(node, 'Icon:Check').length,
    ]),
    inputs: hostsOf(root, 'TextInput').map((node) => {
      const style = flatten(node.props.style);
      return [node.props.value, node.props.placeholder, node.props.accessibilityLabel, style.color === SECONDARY, style.textDecorationLine ?? null];
    }),
    toasts: harness.toasts.slice(seen.toasts).map((toast) => [toast.tone ?? null, toast.title ?? null, toast.message ?? null, toast.durationMs ?? null]),
    writes: writeLog.slice(seen.writes),
    navigation: harness.navigation.slice(seen.navigation),
  };
  seen.writes = writeLog.length;
  seen.toasts = harness.toasts.length;
  seen.navigation = harness.navigation.length;
  return observation;
}

async function perform(root: ReactTestInstance, action: Action) {
  const [kind] = action;
  if (kind === 'fail') {
    failure = action[1];
    return;
  }
  const buttons = hostsOf(root, 'TouchableOpacity');
  const checkboxes = buttons.filter((node) => node.props.accessibilityRole === 'checkbox');
  // Each item's row is the View holding its checkbox, its text box and its delete button.
  const rowOf = (node: ReactTestInstance): ReactTestInstance => (String(node.parent!.type) === 'View' ? node.parent! : rowOf(node.parent!));
  const rows = checkboxes.map(rowOf);
  await act(async () => {
    if (kind === 'toggle') rows[action[1]].findAll((node) => node.props.accessibilityRole === 'checkbox')[0].props.onPress();
    else if (kind === 'rename') hostsOf(rows[action[1]], 'TextInput')[0].props.onChangeText(action[2]);
    else if (kind === 'remove') {
      rows[action[1]].findAll((node) => String(node.type) === 'TouchableOpacity' && node.props.accessibilityRole === 'button')[0].props.onPress();
    } else if (kind === 'add') {
      buttons.filter((node) => node.props.accessibilityRole === 'button' && hostsOf(node, 'Icon:Plus').length > 0)[0].props.onPress();
    } else {
      buttons.filter((node) => hostsOf(node, 'Ionicons').length > 0)[0].props.onPress();
    }
  });
}

async function runScenario(scenario: Scenario) {
  writeLog.length = 0;
  harness.toasts.length = 0;
  harness.navigation.length = 0;
  harness.uuid = 0;
  harness.id = scenario.id;
  failure = null;
  await seedStore();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<FocusChecklistPage />); });
  await act(async () => { await flushPendingSave(); });
  const seen = { writes: 0, toasts: 0, navigation: 0 };
  const observations = [observe(renderer.root, seen)];
  for (const action of scenario.actions) {
    await perform(renderer.root, action);
    await act(async () => { await flushPendingSave(); });
    observations.push(observe(renderer.root, seen));
  }
  await act(async () => { renderer.unmount(); });
  await flushPendingSave();
  return observations;
}

function captureProvenance() {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: new URL('.', import.meta.url).pathname, encoding: 'utf8' });
  const head = git('rev-parse', 'HEAD').trim();
  const declared = process.env.MINDWTR_CAPTURE_FOCUS_CHECKLIST_COMMIT;
  if (declared !== head) throw new Error(`Recapture needs MINDWTR_CAPTURE_FOCUS_CHECKLIST_COMMIT=${head} (the current HEAD); got ${declared ?? 'nothing'}`);
  const allowed = new Set([
    'apps/mobile/components/mind-sweep-modal-content.parity.test.tsx',
    'apps/mobile/app/(drawer)/saved-search/saved-search.parity.test.tsx',
    'apps/mobile/app/check-focus.parity.test.tsx',
    'packages/core/src/mind-sweep-parity.fixtures.json',
    'packages/core/src/saved-search-parity.fixtures.json',
    'packages/core/src/focus-checklist-parity.fixtures.json',
  ]);
  const changed = git('status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean)
    .map((line) => line.slice(3).replace(/^"|"$/g, '')).filter((path) => !allowed.has(path));
  if (changed.length > 0) throw new Error(`Recapture needs HEAD's code only; changed: ${changed.join(', ')}`);
  return {
    command: 'cd apps/mobile && MINDWTR_CAPTURE_FOCUS_CHECKLIST=1 MINDWTR_CAPTURE_FOCUS_CHECKLIST_COMMIT=$(git rev-parse HEAD) TZ=UTC bunx vitest run app/check-focus.parity.test.tsx',
    capturedAt: head,
    sourceState: 'Every file under apps/ and packages/ was at HEAD except the Mind Sweep, saved search and Focus checklist parity harnesses and their fixtures.',
    rendering: 'react-test-renderer over the apps/mobile react-native shim (host elements by name). Theme colors are markers: a button is `tinted` when drawn in the tint, an input is `secondary` when its text uses the secondary color. generateUUID returns uuid-1, uuid-2, ... in each scenario. `fail` makes the next updateTask resolve { success: false, error } (refuse), { success: false } (refuseSilent) or throw. Strings are English.',
  };
}

describe('React Native Focus checklist parity fixture', () => {
  const originalTz = process.env.TZ;
  beforeAll(async () => {
    process.env.TZ = 'UTC';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    harness.strings = await loadTranslations('en');
  }, 30_000);
  afterAll(() => {
    vi.useRealTimers();
    resetForTests();
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('replays every scenario exactly as frozen', async () => {
    const captured: Record<string, unknown> = {};
    for (const scenario of scenarios) captured[scenario.name] = await runScenario(scenario);
    const inputs = normalize({ timeZone: 'UTC', now: NOW, tasks, scenarios }) as Record<string, unknown>;
    if (CAPTURE) {
      writeFileSync(FIXTURE_PATH, `${JSON.stringify({ provenance: captureProvenance(), ...inputs, observations: captured }, null, 1)}\n`);
    }
    const { observations, provenance: _provenance, ...frozenInputs } = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    expect(frozenInputs).toEqual(inputs);
    for (const scenario of scenarios) {
      expect({ [scenario.name]: captured[scenario.name] }).toEqual({ [scenario.name]: observations[scenario.name] });
    }
  }, 120_000);
});
