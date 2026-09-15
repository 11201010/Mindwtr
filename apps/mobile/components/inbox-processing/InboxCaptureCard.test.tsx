import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { InboxCaptureCard } from './InboxCaptureCard';

vi.mock('./SimilarTasksHint', () => ({ SimilarTasksHint: () => null }));

const baseProps: Parameters<typeof InboxCaptureCard>[0] = {
  t: (key) => key,
  tc: {
    bg: '#fff', cardBg: '#fff', border: '#ddd', text: '#111', secondaryText: '#666', tint: '#06f', onTint: '#fff',
  } as any,
  titleInputRef: { current: null as any },
  processingTitle: 'Inbox item',
  setProcessingTitle: vi.fn(),
  similarTasks: [],
  similarTaskProjectTitles: new Map(),
  convertToProject: false,
  processingDescription: '',
  setProcessingDescription: vi.fn(),
  processingTitleFocused: false,
  setProcessingTitleFocused: vi.fn(),
  titleDirectionStyle: {},
  aiEnabled: true,
  isAIWorking: false,
  isAICancellable: false,
  handleAIClarifyInbox: vi.fn(),
  handleAICancelInbox: vi.fn(),
  aiWorkingText: 'Working...',
  notesOpen: false,
  setNotesOpen: vi.fn(),
  isReturningItem: false,
};

const render = async (props: Parameters<typeof InboxCaptureCard>[0]) => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<InboxCaptureCard {...props} />);
  });
  return tree;
};
const buttonWithText = (tree: renderer.ReactTestRenderer, text: string) => tree.root
  .findAllByType(TouchableOpacity)
  .find((button) => button.findAllByType(Text).some((node) => node.props.children === text));

describe('InboxCaptureCard AI lifecycle', () => {
  it('turns the in-flight action into cancellation', async () => {
    const clarify = vi.fn();
    const cancel = vi.fn();
    const tree = await render({
      ...baseProps,
      isAIWorking: true,
      isAICancellable: true,
      handleAIClarifyInbox: clarify,
      handleAICancelInbox: cancel,
    });
    const button = buttonWithText(tree, 'common.cancel');
    if (!button) throw new Error('Cancel button missing');

    act(() => button.props.onPress());

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(clarify).not.toHaveBeenCalled();
    expect(button.props.accessibilityState).toEqual({ disabled: false, busy: true });
  });

  it('keeps manual processing available when AI is disabled', async () => {
    const tree = await render({ ...baseProps, aiEnabled: false });
    expect(buttonWithText(tree, 'taskEdit.aiClarify')).toBeUndefined();
    expect(tree.root.findByProps({ accessibilityLabel: 'taskEdit.titleLabel' })).toBeTruthy();
  });
});
