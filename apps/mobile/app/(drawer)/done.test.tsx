import React from 'react';
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

import DoneScreen from './done';

describe('DoneScreen view state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asyncStorageMock.setItem.mockResolvedValue(undefined);
  });

  it('keeps a sort chosen before device-local state finishes hydrating', async () => {
    let resolveHydration!: (value: string | null) => void;
    asyncStorageMock.getItem.mockReturnValue(new Promise((resolve) => {
      resolveHydration = resolve;
    }));

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<DoneScreen />);
    });

    act(() => {
      tree.root.findByType('TaskList' as never).props.onChangeViewSortBy('title');
    });
    expect(tree.root.findByType('TaskList' as never).props.viewSortBy).toBe('title');

    await act(async () => {
      resolveHydration(JSON.stringify({ groupBy: 'project', sortBy: 'completed' }));
      await Promise.resolve();
    });

    expect(tree.root.findByType('TaskList' as never).props.viewSortBy).toBe('title');
    expect(tree.root.findByType('TaskList' as never).props.groupBy).toBe('none');
  });
});
