import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@mindwtr/core';

import { SomedayView } from './someday-view';

const mocked = vi.hoisted(() => ({
  state: null as any,
  taskListProps: null as any,
  showToast: vi.fn(),
  flush: vi.fn(),
}));

vi.mock('@mindwtr/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mindwtr/core')>();
  return {
    ...actual,
    shallow: vi.fn(),
    flushPendingSave: mocked.flush,
    useTaskStore: Object.assign(
      (selector: (state: unknown) => unknown) => selector(mocked.state),
      { getState: () => mocked.state },
    ),
  };
});

vi.mock('@/contexts/theme-context', () => ({
  useTheme: () => ({ isDark: false }),
}));

vi.mock('@/contexts/language-context', () => ({
  useLanguage: () => ({
    t: (key: string) => key === 'viewSections.noSection' ? 'No section' : key,
  }),
}));

vi.mock('@/hooks/use-theme-colors', () => ({
  useThemeColors: () => ({ bg: '#fff', border: '#ddd', cardBg: '#fff', secondaryText: '#666', text: '#111' }),
}));

vi.mock('@/hooks/use-visible-tasks', () => ({
  useVisibleTaskContext: () => ({
    areaById: new Map(),
    resolvedAreaFilter: { included: [], excluded: [] },
    visibleTasks: mocked.state.tasks,
  }),
}));

vi.mock('@/lib/task-meta-navigation', () => ({
  openContextsScreen: vi.fn(),
  openProjectScreen: vi.fn(),
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));

vi.mock('lucide-react-native', () => ({
  Lightbulb: () => null,
}));

vi.mock('../task-edit-modal', () => ({
  TaskEditModal: () => null,
}));

vi.mock('@/contexts/toast-context', () => ({
  useToast: () => ({ showToast: mocked.showToast }),
}));

vi.mock('@/lib/app-log', () => ({ logError: vi.fn(), logInfo: vi.fn() }));

vi.mock('../someday-section-picker', () => ({
  SomedaySectionPicker: (props: any) => React.createElement('SomedaySectionPicker', props),
}));

vi.mock('@/lib/someday-section-actions', () => ({
  createSomedaySection: vi.fn(async () => 'new-section'),
}));

vi.mock('../task-list-view', () => ({
  TaskListView: (props: unknown) => {
    mocked.taskListProps = props;
    return null;
  },
}));

vi.mock('../task-list/TaskListBulkBar', () => ({
  getBulkMoveStatusOptions: () => [],
}));

vi.mock('../use-task-list-selection', () => ({
  useTaskListSelection: () => ({}),
  assertBulkActionSucceeded: (result: { success?: boolean }) => {
    if (result?.success === false) throw new Error('save failed');
  },
}));

vi.mock('./deferred-projects-section', () => ({
  DeferredProjectsSection: () => null,
  selectDeferredProjects: () => [],
}));

const makeTask = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  title: `Task ${id}`,
  status: 'someday',
  tags: [],
  contexts: [],
  createdAt: '2026-08-27T12:00:00.000Z',
  updatedAt: '2026-08-27T12:00:00.000Z',
  ...overrides,
} as Task);

const setState = (tasks: Task[], somedaySections: { id: string; title: string; order: number }[]) => {
  mocked.state = {
    tasks,
    projects: [],
    settings: { gtd: { viewSections: { someday: somedaySections } } },
    updateTask: vi.fn(),
    updateProject: vi.fn(),
    deleteTask: vi.fn(),
    restoreTask: vi.fn(),
    batchMoveTasks: vi.fn(),
    batchDeleteTasks: vi.fn(),
    batchUpdateTasks: vi.fn(),
    addTask: vi.fn(async () => ({ success: true, id: 'added' })),
    persistenceFailure: null,
    retryPersistence: vi.fn(async () => { mocked.state.persistenceFailure = null; }),
    highlightTaskId: null,
    setHighlightTask: vi.fn(),
  };
};

let renderer: ReactTestRenderer | null = null;

const renderSomedayView = () => {
  act(() => {
    renderer = create(<SomedayView />);
  });
};

describe('SomedayView section grouping', () => {
  beforeEach(() => {
    vi.stubGlobal('React', React);
    mocked.taskListProps = null;
    mocked.flush.mockReset().mockResolvedValue(undefined);
    mocked.showToast.mockClear();
  });

  afterEach(() => {
    if (renderer) {
      act(() => renderer?.unmount());
    }
    renderer = null;
    vi.unstubAllGlobals();
  });

  it('keeps the list flat while no Someday sections are defined', () => {
    setState([makeTask('one'), makeTask('two')], []);

    renderSomedayView();

    expect(mocked.taskListProps.tasks.map((task: Task) => task.id)).toEqual(['one', 'two']);
    expect(mocked.taskListProps.taskGroups).toBeUndefined();
  });

  it('groups the list after the first Someday section is defined', () => {
    setState([
      makeTask('book', { viewSectionIds: { someday: 'books' } }),
      makeTask('unassigned'),
    ], [{ id: 'books', title: 'Books to read', order: 0 }]);

    renderSomedayView();

    expect(mocked.taskListProps.taskGroups.map((group: { title: string }) => group.title))
      .toEqual(['Books to read', 'No section']);
    expect(mocked.taskListProps.taskGroups[0].tasks[0].id).toBe('book');
  });

  it('keeps an empty heading actionable and preassigns a task created there', async () => {
    setState([], [{ id: 'books', title: 'Books to read', order: 0 }]);
    renderSomedayView();
    expect(mocked.taskListProps.taskGroups).toEqual([
      expect.objectContaining({ title: 'Books to read', tasks: [] }),
    ]);

    await act(async () => {
      mocked.taskListProps.onAddTaskToSection('view-section:someday:books');
    });
    const input = renderer!.root.findByType('TextInput' as never);
    await act(async () => { input.props.onChangeText('Read Dune'); });
    const save = renderer!.root.findAllByProps({ accessibilityLabel: 'common.save' })[0];
    await act(async () => { await save.props.onPress(); });

    expect(mocked.state.addTask).toHaveBeenCalledWith('Read Dune', {
      status: 'someday', viewSectionIds: { someday: 'books' },
    });
    await vi.waitFor(() => expect(mocked.flush).toHaveBeenCalledOnce());
    expect(mocked.showToast).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' }));
  });

  it('retries a failed heading task save without creating a duplicate', async () => {
    setState([], [{ id: 'books', title: 'Books to read', order: 0 }]);
    mocked.state.addTask.mockImplementationOnce(async (title: string, props: Partial<Task>) => {
      mocked.state.tasks = [makeTask('added', { title, ...props })];
      return { success: true, id: 'added' };
    });
    mocked.flush.mockImplementationOnce(async () => {
      mocked.state.persistenceFailure = { message: 'disk full', failedAt: 'now', retrying: false };
      throw new Error('disk full');
    }).mockResolvedValue(undefined);
    renderSomedayView();
    await act(async () => { mocked.taskListProps.onAddTaskToSection('view-section:someday:books'); });
    const input = renderer!.root.findByType('TextInput' as never);
    await act(async () => { input.props.onChangeText('Read Dune'); });
    const save = renderer!.root.findAllByProps({ accessibilityLabel: 'common.save' })[0];
    await act(async () => { save.props.onPress(); });
    await vi.waitFor(() => expect(mocked.flush).toHaveBeenCalledOnce());
    expect(mocked.showToast).not.toHaveBeenCalled();
    expect(renderer!.root.findByType('TextInput' as never).props.value).toBe('Read Dune');
    expect(renderer!.root.findByType('TextInput' as never).props.editable).toBe(false);

    const retry = renderer!.root.findAllByProps({ accessibilityLabel: 'Retry' })[0];
    await act(async () => { retry.props.onPress(); });
    await vi.waitFor(() => expect(mocked.state.retryPersistence).toHaveBeenCalledOnce());
    expect(mocked.state.addTask).toHaveBeenCalledOnce();
    expect(mocked.showToast).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' }));
  });

  it('keeps New section in the summary bar without a separate list row', async () => {
    setState([makeTask('one')], [{ id: 'books', title: 'Books to read', order: 0 }]);
    renderSomedayView();
    expect(mocked.taskListProps.onMoveTaskToSection).toEqual(expect.any(Function));
    expect(mocked.taskListProps.onMoveSelectionToSection).toEqual(expect.any(Function));

    const newSection = renderer!.root.findAllByProps({ accessibilityLabel: 'New section…' })[0];
    expect(newSection.props.style).toMatchObject({ minHeight: 44, minWidth: 44 });
    expect(mocked.taskListProps.ListHeaderComponent.props).not.toHaveProperty('children');
    await act(async () => { newSection.props.onPress(); });
    const picker = renderer!.root.findAllByType('SomedaySectionPicker' as never)
      .find((node) => node.props.createOnly);
    expect(picker).toBeDefined();
    expect(picker?.props.sections).toEqual([{ id: 'books', title: 'Books to read', order: 0 }]);
  });
});
