import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import renderer, { act } from 'react-test-renderer';
import { Modal, Pressable, Text, TouchableOpacity } from 'react-native';

import { MobileOnboardingFlow } from './MobileOnboardingFlow';

vi.mock('react-native', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-native')>(),
  useWindowDimensions: () => ({ fontScale: 1, height: 800, scale: 1, width: 400 }),
}));

vi.mock('lucide-react-native', () => ({
  Database: () => null,
  Download: () => null,
  RefreshCw: () => null,
  X: () => null,
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('SafeAreaView', props, children),
}));

vi.mock('@/contexts/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/use-theme-colors', () => ({
  useThemeColors: () => ({
    cardBg: '#fff', inputBg: '#eee', text: '#111', secondaryText: '#555', border: '#ddd',
    danger: '#c00', tint: '#06c', onTint: '#fff',
  }),
}));

vi.mock('@/hooks/use-filled-button-colors', () => ({
  useFilledButtonColors: () => ({ backgroundColor: '#06c', textColor: '#fff' }),
}));

const props = () => ({
  error: null,
  isOpen: true,
  onOpenImport: vi.fn(),
  onOpenSync: vi.fn(),
  onSkip: vi.fn(),
  onStartFresh: vi.fn(),
});

describe('MobileOnboardingFlow', () => {
  it('puts the first useful action before optional sync and import', () => {
    const callbacks = props();
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<MobileOnboardingFlow {...callbacks} />); });
    const actions = tree.root.findAllByType(TouchableOpacity);
    expect(actions.slice(0, 3).map((action) => action.props.onPress)).toEqual([
      callbacks.onStartFresh, callbacks.onOpenSync, callbacks.onOpenImport,
    ]);
    act(() => actions[0].props.onPress());
    expect(callbacks.onStartFresh).toHaveBeenCalledOnce();
    act(() => tree.unmount());
  });
  it('ignores Android Back while seeding and exposes busy accessibility state', () => {
    const callbacks = props();
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<MobileOnboardingFlow {...callbacks} busy />);
    });

    act(() => {
      tree.root.findByType(Modal).props.onRequestClose();
    });
    expect(callbacks.onSkip).not.toHaveBeenCalled();

    const actions = tree.root.findAllByType(TouchableOpacity);
    expect(actions).toHaveLength(4);
    actions.forEach((action) => expect(action.props.accessibilityState?.disabled).toBe(true));
    const startFresh = actions.find((action) => action.props.onPress === callbacks.onStartFresh);
    expect(startFresh?.props.accessibilityState).toEqual({ busy: true, disabled: true });

    const close = tree.root.findByType(Pressable);
    expect(close.props.accessibilityState).toEqual({ disabled: true });
  });

  it('closes once on Android Back when idle and remains usable after an error', () => {
    const callbacks = props();
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<MobileOnboardingFlow {...callbacks} error="seed failed" />);
    });

    act(() => {
      tree.root.findByType(Modal).props.onRequestClose();
    });
    expect(callbacks.onSkip).toHaveBeenCalledTimes(1);
    expect(tree.root.findAllByType(Text).some((node) => node.props.children === 'seed failed')).toBe(true);

    const startFresh = tree.root.findAllByType(TouchableOpacity)
      .find((action) => action.props.onPress === callbacks.onStartFresh);
    expect(startFresh?.props.disabled).toBe(false);
    expect(startFresh?.props.accessibilityState).toEqual({ busy: false, disabled: false });
  });
});
