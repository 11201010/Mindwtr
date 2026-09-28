import React from 'react';
import ReferenceScreen from './reference';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const asyncStorageMock = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: asyncStorageMock,
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

vi.mock('expo-router', () => ({
  Redirect: (props: Record<string, unknown>) => React.createElement('Redirect', props),
  usePathname: () => '/history',
}));

vi.mock('@/hooks/use-theme-colors', () => ({
  useThemeColors: () => ({ bg: '#ffffff' }),
}));

vi.mock('../../contexts/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('../../components/task-list', () => ({
  TaskList: (props: Record<string, unknown>) => React.createElement('TaskList', props),
}));


describe('ReferenceScreen view state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asyncStorageMock.setItem.mockResolvedValue(undefined);
  });

  it('restores a saved grouping when the screen is reopened', async () => {
    asyncStorageMock.getItem.mockResolvedValue('tag');
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<ReferenceScreen />); });
    expect(tree.root.findByType('TaskList' as never).props.groupBy).toBe('tag');
    act(() => { tree.root.findByType('TaskList' as never).props.onChangeGroupBy('project'); });
    expect(asyncStorageMock.setItem).toHaveBeenCalledWith('mindwtr:view:reference:groupBy:v1', 'project');
    act(() => tree.unmount());
    asyncStorageMock.getItem.mockResolvedValue('project');
    await act(async () => { tree = create(<ReferenceScreen />); });
    expect(tree.root.findByType('TaskList' as never).props.groupBy).toBe('project');
    act(() => tree.unmount());
  });

  it('keeps a choice made before hydration finishes', async () => {
    let resolveHydration!: (value: string | null) => void;
    asyncStorageMock.getItem.mockReturnValue(new Promise((resolve) => { resolveHydration = resolve; }));
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<ReferenceScreen />); });
    act(() => { tree.root.findByType('TaskList' as never).props.onChangeGroupBy('tag'); });
    await act(async () => { resolveHydration('area'); });
    expect(tree.root.findByType('TaskList' as never).props.groupBy).toBe('tag');
    act(() => tree.unmount());
  });

  it('uses the default when saved grouping is unsupported', async () => {
    asyncStorageMock.getItem.mockResolvedValue('priority');
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<ReferenceScreen />); });
    expect(tree.root.findByType('TaskList' as never).props.groupBy).toBe('area');
    act(() => tree.unmount());
  });
});
