import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { AREA_FILTER_NONE, projectMatchesAreaFilterSelection } from '@mindwtr/core';
import type { Area, AreaFilterSelection, Project } from '@mindwtr/core';

import { DeferredProjectsSection, selectDeferredProjects } from './deferred-projects-section';

vi.mock('lucide-react-native', () => ({
  Folder: () => null,
  ChevronDown: () => null,
  ChevronRight: () => null,
}));

vi.mock('react-native-gesture-handler', () => ({
  Swipeable: ({ children, ...props }: any) => React.createElement('Swipeable', props, children),
}));

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
  TouchableOpacity: ({ children, ...props }: any) => React.createElement('TouchableOpacity', props, children),
  View: ({ children, ...props }: any) => React.createElement('View', props, children),
}));

const makeProject = (id: string, overrides: Partial<Project> = {}): Project => ({
  id,
  title: `Project ${id}`,
  status: 'someday',
  color: '#2563eb',
  order: 0,
  tagIds: [],
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  ...overrides,
} as Project);

const homeArea = { id: 'area-home', name: 'Home', order: 0 } as Area;
const areaById = new Map<string, Area>([[homeArea.id, homeArea]]);

// The predicate someday-view and waiting-view each carried, copied verbatim from
// before the extraction. Comparing against this — rather than iterating the new
// helper — is what catches the new one quietly accepting a different set.
const legacySelectDeferredProjects = (
  projects: Project[],
  status: 'someday' | 'waiting',
  resolvedAreaFilter: AreaFilterSelection,
) => [...projects]
  .filter((project) => (
    !project.deletedAt
    && project.status === status
    && projectMatchesAreaFilterSelection(project, resolvedAreaFilter, areaById)
  ))
  .sort((a, b) => {
    const aOrder = Number.isFinite(a.order) ? (a.order as number) : Number.POSITIVE_INFINITY;
    const bOrder = Number.isFinite(b.order) ? (b.order as number) : Number.POSITIVE_INFINITY;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.title.localeCompare(b.title);
  });

const candidates: Project[] = [
  makeProject('someday-late', { order: 9, title: 'Zulu' }),
  makeProject('someday-early', { order: 1 }),
  makeProject('someday-unordered', { order: Number.NaN as unknown as number, title: 'Alpha' }),
  makeProject('someday-unordered-2', { order: Number.NaN as unknown as number, title: 'Bravo' }),
  makeProject('someday-deleted', { order: 0, deletedAt: '2026-07-01T00:00:00.000Z' }),
  makeProject('someday-home', { order: 2, areaId: homeArea.id }),
  makeProject('waiting-1', { status: 'waiting', order: 3 }),
  makeProject('waiting-home', { status: 'waiting', order: 1, areaId: homeArea.id }),
  makeProject('waiting-deleted', { status: 'waiting', order: 0, deletedAt: '2026-07-01T00:00:00.000Z' }),
  makeProject('active-1', { status: 'active', order: 0 }),
  makeProject('archived-1', { status: 'archived', order: 0 }),
];

describe('selectDeferredProjects', () => {
  const filters: AreaFilterSelection[] = [
    { included: [], excluded: [] },
    { included: [AREA_FILTER_NONE], excluded: [] },
    { included: [homeArea.id], excluded: [] },
    { included: [], excluded: [homeArea.id] },
  ];

  it.each(['someday', 'waiting'] as const)('matches the old per-screen predicate for %s', (status) => {
    for (const filter of filters) {
      expect(selectDeferredProjects(candidates, status, filter, areaById).map((p) => p.id))
        .toEqual(legacySelectDeferredProjects(candidates, status, filter).map((p) => p.id));
    }
  });

  it('orders by order then title, with unordered projects last', () => {
    const ids = selectDeferredProjects(candidates, 'someday', { included: [], excluded: [] }, areaById).map((p) => p.id);
    expect(ids).toEqual([
      'someday-early',
      'someday-home',
      'someday-late',
      'someday-unordered',
      'someday-unordered-2',
    ]);
  });
});

describe('DeferredProjectsSection', () => {
  const render = (
    projects: Project[],
    handlers: {
      onActivateProject?: (projectId: string) => void;
      onOpenProject?: (projectId: string) => void;
    } = {},
  ) => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <DeferredProjectsSection
          projects={projects}
          areaById={areaById}
          themeColors={{} as never}
          t={(key: string) => key}
          onActivateProject={handlers.onActivateProject ?? vi.fn()}
          onOpenProject={handlers.onOpenProject ?? vi.fn()}
        />,
      );
    });
    return tree;
  };

  it('renders nothing when no project is deferred', () => {
    expect(render([]).toJSON()).toBeNull();
  });

  it('opens a project on press and reactivates it on left swipe', () => {
    const onOpenProject = vi.fn();
    const onActivateProject = vi.fn();
    const project = makeProject('someday-1', { areaId: homeArea.id });

    const tree = render([project], { onOpenProject, onActivateProject });

    act(() => {
      tree.root.findAllByType('TouchableOpacity' as never).find((node) => !node.props.accessibilityState)!.props.onPress();
    });
    expect(onOpenProject).toHaveBeenCalledWith('someday-1');

    act(() => {
      tree.root.findByType('Swipeable' as never).props.onSwipeableLeftOpen();
    });
    expect(onActivateProject).toHaveBeenCalledWith('someday-1');
  });

  it.each(['someday', 'waiting'] as const)('collapses %s projects without changing them and keeps the count visible', (status) => {
    const onOpenProject = vi.fn();
    const onActivateProject = vi.fn();
    const tree = render([makeProject('one', { status }), makeProject('two', { status })], { onOpenProject, onActivateProject });
    const header = () => tree.root.findAllByType('TouchableOpacity' as never).find((node) => node.props.accessibilityState)!;
    expect(header().props.accessibilityLabel).toBe('Projects (2)');
    expect(header().props.accessibilityState.expanded).toBe(true);
    expect(header().props.style.minHeight).toBe(44);
    act(() => header().props.onPress());
    expect(header().props.accessibilityState.expanded).toBe(false);
    expect(header().props.accessibilityLabel).toBe('Projects (2)');
    expect(tree.root.findAllByType('Swipeable' as never)).toHaveLength(0);
    act(() => header().props.onPress());
    expect(tree.root.findAllByType('Swipeable' as never)).toHaveLength(2);
    expect(onOpenProject).not.toHaveBeenCalled();
    expect(onActivateProject).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
