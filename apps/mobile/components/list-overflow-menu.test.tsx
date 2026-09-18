import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { ListOverflowMenu } from './list-overflow-menu';

const native = vi.hoisted(() => ({
  modalProps: null as null | Record<string, any>,
  os: 'ios',
  runAfterInteractions: vi.fn((callback: () => void) => {
    callback();
    return { cancel: vi.fn() };
  }),
}));

vi.mock('react-native', () => ({
  InteractionManager: { runAfterInteractions: native.runAfterInteractions },
  Modal: ({ children, ...props }: any) => {
    native.modalProps = props;
    return React.createElement('Modal', props, children);
  },
  Platform: { get OS() { return native.os; } },
  Pressable: ({ children, onPress, ...props }: any) => React.createElement('Pressable', { ...props, onPress }, children),
  ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
  StyleSheet: { absoluteFillObject: {}, create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
  TouchableOpacity: ({ children, onPress, ...props }: any) => React.createElement('TouchableOpacity', { ...props, onPress }, children),
  View: ({ children, ...props }: any) => React.createElement('View', props, children),
}));

vi.mock('lucide-react-native', () => ({
  ChevronLeft: () => null,
  MoreHorizontal: () => null,
  X: () => null,
}));

vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => false }));

const themeColors = {
  border: '#333',
  cardBg: '#111',
  filterBg: '#222',
  secondaryText: '#999',
  text: '#fff',
  tint: '#60a5fa',
};

describe('ListOverflowMenu', () => {
  it('waits for the iOS modal to dismiss before opening an action destination', () => {
    native.os = 'ios';
    const onOpenFilters = vi.fn();
    let tree!: ReturnType<typeof create>;

    act(() => {
      tree = create(
        <ListOverflowMenu
          actions={[{ id: 'filters', label: 'Filters', onPress: onOpenFilters }]}
          backLabel="Back"
          closeLabel="Close"
          moreLabel="More options"
          themeColors={themeColors}
        />,
      );
    });
    act(() => tree.root.findByProps({ accessibilityLabel: 'More options' }).props.onPress());
    act(() => tree.root.findByProps({ accessibilityLabel: 'Filters' }).props.onPress());

    expect(onOpenFilters).not.toHaveBeenCalled();
    expect(native.modalProps?.visible).toBe(false);
    act(() => native.modalProps?.onDismiss());
    expect(onOpenFilters).toHaveBeenCalledTimes(1);
    expect(native.runAfterInteractions).not.toHaveBeenCalled();
  });

  it('shows an action submenu directly and uses hardware Back to return to the root menu', () => {
    native.os = 'ios';
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <ListOverflowMenu
          actions={[
            { id: 'filters', label: 'Filters', onPress: vi.fn() },
            {
              id: 'sort',
              label: 'Sort',
              accessibilityLabel: 'Sort: Newest',
              value: 'Newest',
              submenu: {
                title: 'Sort',
                actions: [{ id: 'newest', label: 'Newest', onPress: vi.fn() }],
              },
            },
          ]}
          backLabel="Back"
          closeLabel="Close"
          moreLabel="More options"
          themeColors={themeColors}
        />,
      );
    });
    act(() => tree.root.findByProps({ accessibilityLabel: 'More options' }).props.onPress());
    expect(tree.root.findByProps({ accessibilityLabel: 'Sort: Newest' })).toBeTruthy();
    expect(tree.root.findAllByProps({ accessibilityLabel: 'View options' })).toHaveLength(0);
    act(() => tree.root.findByProps({ accessibilityLabel: 'Sort: Newest' }).props.onPress());
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Back' })).not.toHaveLength(0);

    act(() => native.modalProps?.onRequestClose());

    expect(native.modalProps?.visible).toBe(true);
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Back' })).toHaveLength(0);
    expect(tree.root.findByProps({ accessibilityLabel: 'Sort: Newest' })).toBeTruthy();
  });

  it('runs a submenu choice after closing the sheet on Android', () => {
    native.os = 'android';
    native.runAfterInteractions.mockClear();
    const onChooseNewest = vi.fn();
    let tree!: ReturnType<typeof create>;

    act(() => {
      tree = create(
        <ListOverflowMenu
          actions={[{
            id: 'sort',
            label: 'Sort',
            accessibilityLabel: 'Sort: Oldest',
            value: 'Oldest',
            submenu: {
              title: 'Sort',
              actions: [{ id: 'newest', label: 'Newest', onPress: onChooseNewest }],
            },
          }]}
          backLabel="Back"
          closeLabel="Close"
          moreLabel="More options"
          themeColors={themeColors}
        />,
      );
    });

    act(() => tree.root.findByProps({ accessibilityLabel: 'More options' }).props.onPress());
    act(() => tree.root.findByProps({ accessibilityLabel: 'Sort: Oldest' }).props.onPress());
    act(() => tree.root.findByProps({ accessibilityLabel: 'Newest' }).props.onPress());

    expect(native.modalProps?.visible).toBe(false);
    expect(native.runAfterInteractions).toHaveBeenCalledTimes(1);
    expect(onChooseNewest).toHaveBeenCalledTimes(1);
  });
});
