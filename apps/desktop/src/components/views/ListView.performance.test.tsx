import { performance } from 'node:perf_hooks';
import { render } from '@testing-library/react';
import { useTaskStore, type Task } from '@mindwtr/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { LanguageProvider } from '../../contexts/language-context';
import { KeybindingProvider } from '../../contexts/keybinding-context';
import { useUiStore } from '../../store/ui-store';
import { ListView } from './ListView';

const LARGE_TASK_COUNT = 5_000;
const LIST_VIEW_RENDER_BUDGET_MS = 500;
const NOW = '2026-08-09T12:00:00.000Z';
const describePerf = process.env.MINDWTR_PERF_TEST === '1' ? describe : describe.skip;

const initialTaskState = useTaskStore.getState();
const initialUiState = useUiStore.getState();

const tasks: Task[] = Array.from({ length: LARGE_TASK_COUNT }, (_, index) => ({
  id: `desktop-perf-task-${index}`,
  title: `Desktop performance task ${index}`,
  status: 'next',
  tags: [`#tag-${index % 8}`],
  contexts: [`@context-${index % 6}`],
  priority: index % 3 === 0 ? 'high' : 'medium',
  timeEstimate: index % 2 === 0 ? '15min' : '30min',
  createdAt: NOW,
  updatedAt: NOW,
  order: index,
}));

const renderListView = () => render(
  <LanguageProvider>
    <KeybindingProvider currentView="next" onNavigate={() => {}}>
      <ListView title="Next" statusFilter="next" />
    </KeybindingProvider>
  </LanguageProvider>,
);

describePerf('ListView large-store performance budget', () => {
  beforeEach(() => {
    useTaskStore.setState(initialTaskState, true);
    useUiStore.setState(initialUiState, true);
    useTaskStore.setState({
      _allAreas: [],
      _allProjects: [],
      _allTasks: tasks,
      areas: [],
      lastDataChangeAt: 1,
      projects: [],
      settings: {
        appearance: { density: 'comfortable' },
        features: { priorities: true, timeEstimates: true },
      },
      tasks,
    });
    useUiStore.setState((state) => ({
      ...state,
      listFilters: { criteria: {}, open: false },
      listOptions: {
        ...state.listOptions,
        nextGroupBy: 'none',
        showDetails: false,
      },
    }));
  });

  it('renders and virtualizes 5,000 next actions within budget', () => {
    let bestMs = Number.POSITIVE_INFINITY;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const startedAt = performance.now();
      const view = renderListView();
      bestMs = Math.min(bestMs, performance.now() - startedAt);
      expect(view.getByTestId('virtualized-task-list')).toBeInTheDocument();
      view.unmount();
    }

    expect(
      bestMs,
      `Desktop ListView render took ${bestMs.toFixed(1)}ms with ${LARGE_TASK_COUNT} tasks; budget is ${LIST_VIEW_RENDER_BUDGET_MS}ms`,
    ).toBeLessThanOrEqual(LIST_VIEW_RENDER_BUDGET_MS);
  }, 15_000);
});
