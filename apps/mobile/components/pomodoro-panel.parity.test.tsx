import React from 'react';
import { Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildPomodoroPanelModel, getTranslator, type AppSettings, type Task } from '@mindwtr/core';

import { PomodoroPanel } from './pomodoro-panel';
import { mobilePomodoroController } from '../lib/pomodoro-controller';

const { state } = vi.hoisted(() => ({
  state: {
    store: { tasks: [] as Task[], updateTask: () => Promise.resolve(), settings: {} as AppSettings },
    language: 'en' as 'en' | 'zh',
    device: new Map<string, string>(),
  },
}));

vi.mock('@mindwtr/core', async () => {
  const actual = await vi.importActual<typeof import('@mindwtr/core')>('@mindwtr/core');
  const useTaskStore = Object.assign((selector?: (store: typeof state.store) => unknown) => (selector ? selector(state.store) : state.store),
    { getState: () => state.store });
  return { ...actual, useTaskStore };
});
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => state.device.get(key) ?? null),
    setItem: vi.fn(async (key: string, text: string) => { state.device.set(key, text); }),
  },
}));
vi.mock('../contexts/language-context', () => ({ useLanguage: () => ({ t: getTranslator(state.language) }) }));
vi.mock('@/hooks/use-theme-colors', () => ({
  useThemeColors: () => ({ cardBg: '#111827', filterBg: '#1f2937', border: '#334155', text: '#f8fafc', secondaryText: '#94a3b8', tint: '#3b82f6',
    onTint: '#ffffff', success: '#10b981' }),
}));
vi.mock('@/hooks/use-filled-button-colors', () => ({ useFilledButtonColors: () => ({ backgroundColor: '#3b82f6', textColor: '#ffffff' }) }));
vi.mock('../lib/app-log', () => ({ logWarn: vi.fn(async () => undefined) }));

const task = (id: string, title: string): Task => ({ id, title, status: 'next', tags: [], contexts: [], createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z' } as Task);

/** RN's card as drawn: every text in order. */
async function renderCard(pickerTasks: Task[]) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<PomodoroPanel tasks={pickerTasks} onMarkDone={vi.fn()} />);
  });
  await act(async () => { await mobilePomodoroController.ensureHydrated(); });
  const texts = tree.root.findAllByType(Text).map((node) => node.props.children).filter((child): child is string => typeof child === 'string');
  act(() => tree.unmount());
  return texts;
}

describe('the Focus screen\'s Pomodoro card: parity with core\'s model', () => {
  beforeEach(() => {
    mobilePomodoroController.resetForTests();
    state.device.clear();
    vi.mocked(AsyncStorage.getItem).mockClear();
  });

  it.each([
    { name: 'a paused timer', language: 'en', settings: {}, session: null, collapsed: null, linked: false },
    { name: 'a running timer linked to a task, custom durations', language: 'zh',
      settings: { gtd: { pomodoro: { linkTask: true, customDurations: { focusMinutes: 40, breakMinutes: 8 } } } },
      session: { durations: { focusMinutes: 40, breakMinutes: 8 }, timerState: { phase: 'focus', remainingSeconds: 2400, isRunning: true, completedFocusSessions: 0 },
        phaseEndsAt: new Date(Date.now() + 20 * 60_000).toISOString(), selectedTaskId: 'a' }, collapsed: 'false', linked: true },
    { name: 'a finished focus phase, link on, no task', language: 'en', settings: { gtd: { pomodoro: { linkTask: true } } },
      session: { durations: { focusMinutes: 25, breakMinutes: 5 }, timerState: { phase: 'focus', remainingSeconds: 10, isRunning: true, completedFocusSessions: 0 },
        phaseEndsAt: new Date(Date.now() - 1_000).toISOString() }, collapsed: null, linked: false },
    { name: 'the folded card', language: 'en', settings: {}, session: { timerState: { phase: 'break', remainingSeconds: 120, isRunning: false } }, collapsed: 'true', linked: false },
  ] as const)('$name', async ({ language, settings, session, collapsed, linked }) => {
    state.language = language;
    state.store = { tasks: [task('a', 'Write the report'), task('b', 'Call Sam')], updateTask: () => Promise.resolve(), settings: settings as AppSettings };
    if (session) state.device.set('@mindwtr_pomodoro_state', JSON.stringify(session));
    if (collapsed) state.device.set('@mindwtr_pomodoro_collapsed', collapsed);
    const pickerTasks = linked ? state.store.tasks : [];
    const rn = await renderCard(pickerTasks);
    const model = buildPomodoroPanelModel({
      session: mobilePomodoroController.getSnapshot(), settings: settings as AppSettings, tasks: state.store.tasks, collapsed: collapsed === 'true',
      t: getTranslator(language),
    });
    if (model.collapsed) {
      expect(rn).toEqual([model.clock, model.status]);
      return;
    }
    const link = model.link ? [model.link.label, model.link.value, model.link.changeLabel, ...(model.link.markDone ? [model.link.markDone.label] : [])] : [];
    // The picker's modal (drawn closed too); its FlatList rows need a layout the test renderer has not, so core's picker tests own them.
    const picker = model.link ? [model.picker.title, model.picker.timerOnly.label] : [];
    expect(rn).toEqual([
      model.title, model.phaseLabel, ...(model.loading ? [model.loading] : []), ...model.presets.map((preset) => preset.label),
      model.clock, model.sessions, ...link, model.primary.label, model.reset.label, model.switchPhase.label, ...(model.event ? [model.event] : []), ...picker,
    ]);
  });
});
