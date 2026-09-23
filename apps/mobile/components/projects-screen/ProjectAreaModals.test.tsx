import React from 'react';
import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import type { Area } from '@mindwtr/core';

import { ProjectAreaModals } from './ProjectAreaModals';

vi.mock('../../lib/use-android-keyboard-inset', () => ({ useAndroidKeyboardInset: () => 0 }));

const now = '2026-09-22T00:00:00.000Z';
const areas: Area[] = ['a', 'b', 'c'].map((id, order) => ({
  id, name: id, order, createdAt: now, updatedAt: now,
}));

const renderManager = (reorderAreas = vi.fn(), addArea = vi.fn()) => {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<ProjectAreaModals
      addArea={addArea}
      areaListMaxHeight={200}
      areaManagerListMaxHeight={200}
      areaUsage={new Map()}
      colors={['#3b82f6']}
      expandedAreaColorId={null}
      newAreaColor="#3b82f6"
      newAreaName="New area"
      onCloseAreaManager={vi.fn()}
      onDeleteArea={vi.fn()}
      onSetExpandedAreaColorId={vi.fn()}
      onSetNewAreaColor={vi.fn()}
      onSetNewAreaName={vi.fn()}
      onSetSelectedProject={vi.fn()}
      onSetShowAreaManager={vi.fn()}
      onSetShowAreaPicker={vi.fn()}
      onShowToast={vi.fn()}
      overlayModalPresentation="overFullScreen"
      pickerCardMaxHeight={400}
      reorderAreas={reorderAreas}
      selectedProject={null}
      showAreaManager
      showAreaPicker={false}
      sortedAreas={areas}
      sortAreasByColor={vi.fn()}
      sortAreasByName={vi.fn()}
      t={(key) => key}
      tc={{ border: '#aaa', cardBg: '#fff', inputBg: '#fff', secondaryText: '#777', text: '#000', tint: '#00f' }}
      updateArea={vi.fn()}
      updateProject={vi.fn()}
    />);
  });
  return tree;
};

it('moves an area through the existing reorder action', () => {
  const reorderAreas = vi.fn();
  const tree = renderManager(reorderAreas);
  expect(tree.root.findByProps({ accessibilityLabel: 'projects.moveUp: a' }).props.disabled).toBe(true);
  act(() => tree.root.findByProps({ accessibilityLabel: 'projects.moveUp: c' }).props.onPress());
  expect(reorderAreas).toHaveBeenCalledWith(['a', 'c', 'b']);
});

it('allows area creation from the Projects list without an open project', () => {
  const addArea = vi.fn();
  const tree = renderManager(vi.fn(), addArea);
  act(() => tree.root.findByProps({ accessibilityLabel: 'common.save' }).props.onPress());
  expect(addArea).toHaveBeenCalledWith('New area', { color: '#3b82f6' });
});
