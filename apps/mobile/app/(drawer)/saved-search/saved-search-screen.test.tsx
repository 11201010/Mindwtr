import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { Task } from '@mindwtr/core';

const now = '2026-06-11T00:00:00.000Z';

const makeTask = (id: string, title: string): Task => ({
  id,
  title,
  status: 'next',
  contexts: [],
  tags: [],
  createdAt: now,
  updatedAt: now,
} as Task);

const alerts = vi.hoisted(() => [] as { text: string; onPress?: () => unknown }[][]);

const storeState = vi.hoisted(() => ({
  tasks: [] as Task[],
  projects: [],
  settings: {
    savedSearches: [{ id: 'search-1', name: 'Loose ends', query: 'loose' }],
    taskSortBy: 'default',
  },
  updateTask: vi.fn(async () => undefined),
  deleteTask: vi.fn(async () => undefined),
  fetchData: vi.fn(async () => undefined),
  updateSettings: vi.fn(async () => undefined),
}));

vi.mock('@mindwtr/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mindwtr/core')>();
  return {
    ...actual,
    shallow: Object.is,
    useTaskStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
  };
});

vi.mock('expo-router', () => ({
  router: { back: vi.fn(), canGoBack: () => false, replace: vi.fn() },
  useLocalSearchParams: () => ({ id: 'search-1' }),
}));

vi.mock('@/contexts/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('@/contexts/theme-context', () => ({
  useTheme: () => ({ isDark: false }),
}));

vi.mock('@/hooks/use-theme-colors', () => {
  // One object, like the real hook: rows compare `tc` by identity (#766).
  const themeColors = {
    bg: '#ffffff',
    border: '#d1d5db',
    cardBg: '#ffffff',
    secondaryText: '#64748b',
    taskItemBg: '#ffffff',
    text: '#0f172a',
    tint: '#2563eb',
  };
  return { useThemeColors: () => themeColors };
});

vi.mock('@/hooks/use-mobile-area-filter', () => ({
  useMobileAreaFilter: () => ({
    areaById: new Map(),
    resolvedAreaFilter: { included: [], excluded: [] },
    sortedAreas: [],
  }),
}));

vi.mock('@/lib/task-meta-navigation', () => ({
  openContextsScreen: vi.fn(),
  openProjectScreen: vi.fn(),
}));

vi.mock('@/components/task-edit-modal', () => ({
  TaskEditModal: (props: any) => React.createElement('TaskEditModal', props),
}));

vi.mock('@/components/swipeable-task-item', () => ({
  SwipeableTaskItem: (props: any) => React.createElement('SwipeableTaskItem', props),
}));

vi.mock('lucide-react-native', () => ({
  Trash2: (props: any) => React.createElement('Trash2', props),
}));

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  return {
    ...actual,
    Alert: { alert: (_title: string, _message: string, buttons: (typeof alerts)[number]) => { alerts.push(buttons); } },
    RefreshControl: (props: any) => React.createElement('RefreshControl', props),
    FlatList: ({ data = [], renderItem, keyExtractor, ListEmptyComponent, ...props }: any) => (
      React.createElement(
        'FlatList',
        props,
        data.length > 0
          ? data.map((item: any, index: number) => (
            <React.Fragment key={keyExtractor?.(item, index) ?? item.id ?? index}>
              {renderItem?.({ item, index })}
            </React.Fragment>
          ))
          : null,
      )
    ),
  };
});

import SavedSearchScreen from './[id]';

describe('SavedSearchScreen', () => {
  // Rows carry the #766 memo boundary, which only holds while the screen hands
  // untouched rows the same references back.
  it('hands rows stable prop references across a re-render', async () => {
    storeState.tasks = [makeTask('task-1', 'loose one'), makeTask('task-2', 'loose two')];

    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<SavedSearchScreen />);
    });

    const rowProps = () => tree.root
      .findAll((node) => (node.type as unknown) === 'SwipeableTaskItem')
      .map((node) => node.props);
    const before = rowProps();
    expect(before).toHaveLength(2);
    expect(before[0].actions).toBe(before[1].actions);

    await act(async () => {
      tree.update(<SavedSearchScreen />);
    });

    const after = rowProps();
    expect(after[1].task).toBe(before[1].task);
    expect(after[1].actions).toBe(before[1].actions);
    expect(after[1].tc).toBe(before[1].tc);
  });

  it('labels the Delete icon as a button', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<SavedSearchScreen />);
    });

    const [deleteButton] = tree.root.findAll((node) => (
      typeof node.type === 'string' && node.findAll((child) => (child.type as unknown) === 'Trash2').length > 0
      && node.props.onPress !== undefined
    ));
    expect(deleteButton.props.accessibilityRole).toBe('button');
    expect(deleteButton.props.accessibilityLabel).toBeTruthy();
  });

  // The confirmation may stay open while another device or screen changes the
  // saved searches: Delete removes this one from the list as it is then.
  it('deletes against the current saved searches, not the list from render', async () => {
    const core = await vi.importActual<typeof import('@mindwtr/core')>('@mindwtr/core');
    const added = { id: 'search-2', name: 'Added meanwhile', query: 'meanwhile' };
    const updateSettings = vi.fn(async () => undefined);
    core.useTaskStore.setState({
      settings: { savedSearches: [...storeState.settings.savedSearches, added] },
      updateSettings,
    } as never);
    alerts.length = 0;

    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<SavedSearchScreen />);
    });
    const deleteButton = tree.root.find((node) => (
      typeof node.type === 'string' && node.props.accessibilityLabel !== undefined
      && node.findAll((child) => (child.type as unknown) === 'Trash2').length > 0
    ));
    await act(async () => { deleteButton.props.onPress(); });
    const confirm = alerts[0].at(-1)!;
    await act(async () => { await confirm.onPress?.(); });

    expect(updateSettings).toHaveBeenCalledWith({ savedSearches: [added] });
  });
});
