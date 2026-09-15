import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Modal: ({ visible, children, ...props }: any) => visible
    ? React.createElement('Modal', props, children) : null,
  Pressable: ({ children, ...props }: any) => React.createElement('Pressable', props, children),
  Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
  View: ({ children, ...props }: any) => React.createElement('View', props, children),
}));

vi.mock('../../hooks/use-status-colors', () => ({
  useStatusColors: () => ({
    inbox: { text: '#fff', bg: '#222' },
    next: { text: '#fff', bg: '#222' },
    waiting: { text: '#fff', bg: '#222' },
    someday: { text: '#fff', bg: '#222' },
    done: { text: '#fff', bg: '#222' },
    reference: { text: '#fff', bg: '#222' },
  }),
}));

vi.mock('./swipeable-task-item.styles', () => ({ styles: {} }));

import { SwipeableTaskItemStatusMenu } from './SwipeableTaskItemStatusMenu';

const baseProps = {
  visible: true,
  taskStatus: 'someday' as const,
  onClose: vi.fn(),
  onStatusChange: vi.fn(),
  tc: { cardBg: '#fff', border: '#ddd', text: '#111' } as any,
  t: (key: string) => key,
};

describe('Someday task menu', () => {
  it('offers Move to section without changing task status or opening the editor', () => {
    const onMoveToSection = vi.fn();
    let tree: ReturnType<typeof create>;
    act(() => { tree = create(<SwipeableTaskItemStatusMenu {...baseProps} onMoveToSection={onMoveToSection} />); });
    const button = tree!.root.findAllByType('Pressable' as never)
      .find((node) => node.props.accessibilityLabel === 'Move to section…');
    expect(button).toBeDefined();
    act(() => { button?.props.onPress(); });
    expect(onMoveToSection).toHaveBeenCalledOnce();
    expect(baseProps.onStatusChange).not.toHaveBeenCalled();
    expect(baseProps.onClose).toHaveBeenCalledOnce();
    act(() => tree!.unmount());
  });

  it('does not add section controls to lists that do not supply the action', () => {
    let tree: ReturnType<typeof create>;
    act(() => { tree = create(<SwipeableTaskItemStatusMenu {...baseProps} />); });
    expect(tree!.root.findAllByProps({ accessibilityLabel: 'Move to section…' })).toHaveLength(0);
    act(() => tree!.unmount());
  });
});
