import React from 'react';
import { TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@mindwtr/core';

import FocusChecklistPage from './check-focus';

const routerBackMock = vi.hoisted(() => vi.fn());
const showToastMock = vi.hoisted(() => vi.fn());
const updateTaskMock = vi.hoisted(() => vi.fn());
const routeParams = vi.hoisted(() => ({ id: 'task-1' as string | string[] | undefined }));
const storeState = vi.hoisted(() => ({
    tasks: [] as Task[],
    updateTask: updateTaskMock,
}));
const themeColors = vi.hoisted(() => ({
    bg: '#101820',
    border: '#334155',
    cardBg: '#17212b',
    danger: '#ef4444',
    inputBg: '#1e293b',
    onTint: '#f8fafc',
    secondaryText: '#94a3b8',
    text: '#f8fafc',
    tint: '#60a5fa',
}));

vi.mock('@mindwtr/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@mindwtr/core')>();
    return {
        ...actual,
        generateUUID: () => 'new-checklist-item',
        useTaskStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
    };
});

vi.mock('expo-router', () => ({
    useLocalSearchParams: () => routeParams,
    useRouter: () => ({ back: routerBackMock }),
}));

vi.mock('react-native-safe-area-context', () => ({
    SafeAreaView: (props: any) => React.createElement('SafeAreaView', props, props.children),
}));

vi.mock('@expo/vector-icons', () => ({
    Ionicons: (props: any) => React.createElement('Ionicons', props),
}));

vi.mock('lucide-react-native', () => ({
    Check: (props: any) => React.createElement('Check', props),
    Plus: (props: any) => React.createElement('Plus', props),
    Trash2: (props: any) => React.createElement('Trash2', props),
}));

vi.mock('../hooks/use-theme-colors', () => ({
    useThemeColors: () => themeColors,
}));

vi.mock('../contexts/language-context', () => ({
    useLanguage: () => ({
        t: (key: string) => ({
            'common.back': 'Zurück',
            'common.delete': 'Löschen',
            'common.error': 'Fehler',
            'list.noTasks': 'Keine Aufgaben gefunden',
            'task.updateFailed': 'Aufgabe konnte nicht aktualisiert werden.',
            'taskEdit.addItem': 'Eintrag hinzufügen',
            'taskEdit.itemNamePlaceholder': 'Name des Eintrags',
            'taskEdit.noChecklistItems': 'Keine Checklisteneinträge',
        }[key] ?? key),
    }),
}));

vi.mock('../contexts/toast-context', () => ({
    useToast: () => ({ showToast: showToastMock }),
}));

const now = '2026-08-26T12:00:00.000Z';
const makeTask = (overrides: Partial<Task> = {}): Task => ({
    id: 'task-1',
    title: 'Prepare launch',
    status: 'next',
    tags: [],
    contexts: [],
    checklist: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
});

const flattenStyle = (style: unknown): Record<string, unknown> => {
    if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
    return style && typeof style === 'object' ? style as Record<string, unknown> : {};
};

const renderScreen = (): ReactTestRenderer => {
    let tree!: ReactTestRenderer;
    act(() => {
        tree = create(<FocusChecklistPage />);
    });
    return tree;
};

describe('FocusChecklistPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        routeParams.id = 'task-1';
        storeState.tasks = [makeTask()];
        updateTaskMock.mockResolvedValue({ success: true });
    });

    it('uses theme tokens and localized empty-state actions', () => {
        const tree = renderScreen();

        const safeArea = tree.root.findByType('SafeAreaView' as any);
        expect(flattenStyle(safeArea.props.style)).toMatchObject({ backgroundColor: themeColors.bg });
        expect(tree.root.findByProps({ children: 'Keine Checklisteneinträge' })).toBeDefined();
        expect(tree.root.findByProps({ accessibilityLabel: 'Eintrag hinzufügen' }).props.accessibilityRole).toBe('button');
    });

    it('localizes and themes the missing-task state', () => {
        storeState.tasks = [];

        const tree = renderScreen();
        const safeArea = tree.root.findByType('SafeAreaView' as any);
        const message = tree.root.findByProps({ children: 'Keine Aufgaben gefunden' });

        expect(flattenStyle(safeArea.props.style)).toMatchObject({ backgroundColor: themeColors.bg });
        expect(flattenStyle(message.props.style)).toMatchObject({ color: themeColors.text });
    });

    it('offers the header Back on the missing-task state', () => {
        storeState.tasks = [];

        const tree = renderScreen();
        const back = tree.root.findByProps({ accessibilityLabel: 'Zurück', accessibilityRole: 'button' });
        act(() => {
            back.props.onPress();
        });

        expect(routerBackMock).toHaveBeenCalledTimes(1);
    });

    it('labels checklist editing, completion, and item-specific deletion', () => {
        storeState.tasks = [makeTask({
            checklist: [{ id: 'check-1', title: 'Pack cables', isCompleted: true }],
        })];

        const tree = renderScreen();
        const checkbox = tree.root.findByProps({
            accessibilityLabel: 'Pack cables',
            accessibilityRole: 'checkbox',
        });
        const editor = tree.root.findByType(TextInput);
        const deleteButton = tree.root.findByProps({ accessibilityLabel: 'Löschen: Pack cables' });

        expect(checkbox.props.accessibilityState).toEqual({ checked: true });
        expect(flattenStyle(checkbox.props.style)).toMatchObject({
            backgroundColor: themeColors.tint,
            borderColor: themeColors.tint,
        });
        expect(flattenStyle(editor.props.style)).toMatchObject({ color: themeColors.secondaryText });
        expect(editor.props.accessibilityLabel).toBe('Name des Eintrags');
        expect(deleteButton.props.accessibilityRole).toBe('button');
    });

    it('keeps optimistic feedback and rolls it back when persistence rejects the write', async () => {
        let resolveWrite!: (value: { success: false; error: string }) => void;
        updateTaskMock.mockReturnValue(new Promise((resolve) => {
            resolveWrite = resolve;
        }));
        storeState.tasks = [makeTask({
            checklist: [{ id: 'check-1', title: 'Pack cables', isCompleted: false }],
        })];
        const tree = renderScreen();
        const findCheckbox = () => tree.root.findByProps({
            accessibilityLabel: 'Pack cables',
            accessibilityRole: 'checkbox',
        });

        act(() => {
            findCheckbox().props.onPress();
        });
        expect(findCheckbox().props.accessibilityState).toEqual({ checked: true });

        await act(async () => {
            resolveWrite({ success: false, error: 'Disk full' });
            await Promise.resolve();
        });

        expect(findCheckbox().props.accessibilityState).toEqual({ checked: false });
        expect(updateTaskMock).toHaveBeenCalledWith('task-1', {
            checklist: [{ id: 'check-1', title: 'Pack cables', isCompleted: true }],
        });
        expect(showToastMock).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Disk full',
            tone: 'error',
        }));
    });

    it('after a failed write shows what the store holds, not the list from before that edit', async () => {
        // Tick A (its write is slow, then fails); rename B meanwhile (saved, built on the ticked list, so the store holds both).
        let failTick!: (value: { success: false; error: string }) => void;
        updateTaskMock
            .mockReturnValueOnce(new Promise((resolve) => { failTick = resolve; }))
            .mockResolvedValueOnce({ success: true });
        const a = { id: 'a', title: 'Pack cables', isCompleted: false };
        const b = { id: 'b', title: 'Charge laptop', isCompleted: false };
        storeState.tasks = [makeTask({ checklist: [a, b] })];
        const tree = renderScreen();
        const checkbox = (title: string) => tree.root.findByProps({ accessibilityLabel: title, accessibilityRole: 'checkbox' });

        act(() => { checkbox('Pack cables').props.onPress(); });
        await act(async () => {
            tree.root.findAllByType(TextInput)[1].props.onChangeText('Charge phone');
            await Promise.resolve();
        });
        await act(async () => {
            storeState.tasks = [makeTask({ checklist: [{ ...a, isCompleted: true }, { ...b, title: 'Charge phone' }], updatedAt: '2026-08-26T12:00:01.000Z' })];
            tree.update(<FocusChecklistPage />);
            await Promise.resolve();
        });
        await act(async () => {
            failTick({ success: false, error: 'Disk full' });
            await Promise.resolve();
        });

        expect(checkbox('Pack cables').props.accessibilityState).toEqual({ checked: true });
        expect(tree.root.findAllByType(TextInput).map((input) => input.props.value)).toEqual(['Pack cables', 'Charge phone']);
    });
});
