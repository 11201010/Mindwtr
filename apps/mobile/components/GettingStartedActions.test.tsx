import React from 'react';
import { Pressable, Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { GettingStartedActions } from './GettingStartedActions';

vi.mock('@/contexts/language-context', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock('@/hooks/use-theme-colors', () => ({
    useThemeColors: () => ({ text: '#111', secondaryText: '#555', border: '#ddd', cardBg: '#fff', filterBg: '#eee' }),
}));
vi.mock('lucide-react-native', () => ({ Inbox: () => null, Plus: () => null, Star: () => null }));

describe('GettingStartedActions', () => {
    it('provides labelled, touch-sized actions for the real capture, Inbox, and Focus workflows', () => {
        const onAction = vi.fn();
        let tree!: renderer.ReactTestRenderer;
        act(() => { tree = renderer.create(<GettingStartedActions onAction={onAction} />); });
        const buttons = tree.root.findAllByType(Pressable);
        expect(buttons).toHaveLength(3);
        expect(buttons.map((button) => button.findByType(Text).props.children)).toEqual([
            'onboarding.captureAction', 'starter.processInbox.check1', 'starter.focus.check1',
        ]);
        for (const button of buttons) {
            expect(button.props.accessibilityRole).toBe('button');
            expect(Object.assign({}, ...button.props.style({ pressed: false })).minHeight).toBeGreaterThanOrEqual(44);
            act(() => button.props.onPress());
        }
        expect(onAction.mock.calls).toEqual([['capture'], ['inbox'], ['focus']]);
        act(() => tree.unmount());
    });
});
