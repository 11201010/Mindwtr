import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const storeState = vi.hoisted(() => ({
  addTask: vi.fn(),
}));

vi.mock('@mindwtr/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mindwtr/core')>();
  return {
    ...actual,
    shallow: Object.is,
    useTaskStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
  };
});
vi.mock('../contexts/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'en' }),
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: any) => React.createElement('SafeAreaView', props, props.children),
}));
vi.mock('@/hooks/use-theme-colors', () => {
  const colors = {
    bg: '#fff', border: '#cbd5e1', text: '#0f172a', secondaryText: '#64748b', tint: '#3b82f6', onTint: '#fff', danger: '#ef4444',
  };
  return { useThemeColors: () => colors };
});
vi.mock('@/hooks/use-filled-button-colors', () => ({ useFilledButtonColors: () => ({ backgroundColor: '#3b82f6', textColor: undefined }) }));

import { MindSweepModalContent } from './mind-sweep-modal-content';

const byTestId = (root: ReactTestInstance, testID: string) => root.findAll((node) => (
  typeof node.type === 'string' && node.props.testID === testID
))[0];

describe('MindSweepModalContent', () => {
  it('marks the chosen scope as selected', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<MindSweepModalContent onClose={() => undefined} />); });
    await act(async () => { byTestId(tree.root, 'mind-sweep-scope-work').props.onPress(); });

    expect(byTestId(tree.root, 'mind-sweep-scope-work').props.accessibilityState).toEqual({ selected: true });
    expect(byTestId(tree.root, 'mind-sweep-scope-all').props.accessibilityState).toEqual({ selected: false });
  });

  it('keeps text typed while an add was saving', async () => {
    let finishAdd!: (value: { success: true }) => void;
    storeState.addTask.mockReturnValueOnce(new Promise((resolve) => { finishAdd = resolve; }));
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<MindSweepModalContent onClose={() => undefined} />); });
    await act(async () => { byTestId(tree.root, 'mind-sweep-start').props.onPress(); });
    const input = () => byTestId(tree.root, 'mind-sweep-input');

    await act(async () => { input().props.onChangeText('Fix the sink'); });
    await act(async () => { byTestId(tree.root, 'mind-sweep-add').props.onPress(); });
    await act(async () => { input().props.onChangeText('Call mom'); });
    await act(async () => { finishAdd({ success: true }); });

    expect(storeState.addTask).toHaveBeenCalledWith('Fix the sink', { status: 'inbox' });
    expect(input().props.value).toBe('Call mom');
  });
});
