import React from 'react';
import { Pressable } from 'react-native';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HistoryScreen from './history';

const routeState = vi.hoisted(() => ({ tab: undefined as string | undefined }));
const setParams = vi.hoisted(() => vi.fn());

vi.mock('expo-router', () => ({
    useLocalSearchParams: () => ({ tab: routeState.tab }),
    useRouter: () => ({ setParams }),
}));

vi.mock('./done', () => ({
    default: () => React.createElement('DoneContent'),
}));

vi.mock('./archived', () => ({
    default: () => React.createElement('ArchivedContent'),
}));

vi.mock('../../contexts/language-context', () => ({
    useLanguage: () => ({
        t: (key: string) => ({ 'nav.done': 'Done', 'nav.archived': 'Archived' }[key] ?? key),
    }),
}));

vi.mock('@/hooks/use-theme-colors', () => ({
    useThemeColors: () => ({
        bg: '#fff', cardBg: '#fff', border: '#ddd', tint: '#06f', secondaryText: '#666',
    }),
}));

describe('HistoryScreen', () => {
    beforeEach(() => {
        routeState.tab = undefined;
        setParams.mockReset();
    });

    it('defaults to Done and switches to Archived in the same surface', () => {
        let tree!: ReturnType<typeof create>;
        act(() => { tree = create(<HistoryScreen />); });

        expect(tree.root.findAllByType('DoneContent' as never)).toHaveLength(1);
        const archivedTab = tree.root.findAllByType(Pressable).find(
            (node) => node.props.accessibilityLabel === 'Archived',
        );
        expect(archivedTab).toBeTruthy();

        act(() => archivedTab!.props.onPress());

        expect(tree.root.findAllByType('ArchivedContent' as never)).toHaveLength(1);
        expect(setParams).toHaveBeenCalledWith({ tab: 'archived' });
    });

    it('honors an archived deep link on first render', () => {
        routeState.tab = 'archived';
        let tree!: ReturnType<typeof create>;
        act(() => { tree = create(<HistoryScreen />); });

        expect(tree.root.findAllByType('ArchivedContent' as never)).toHaveLength(1);
    });
});
