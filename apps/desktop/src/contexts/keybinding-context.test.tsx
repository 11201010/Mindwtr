import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { useCallback, useEffect, useState } from 'react';
import { LanguageProvider } from './language-context';
import { KeybindingProvider } from './keybinding-context';
import { useKeybindings } from './keybinding-context';
import { useUiStore } from '../store/ui-store';

const DummyList = () => {
    const { registerTaskListScope } = useKeybindings();
    const [selectedIndex, setSelectedIndex] = useState(0);
    const ids = ['1', '2'];

    const selectNext = useCallback(() => {
        setSelectedIndex((i) => Math.min(i + 1, ids.length - 1));
    }, [ids.length]);

    const selectPrev = useCallback(() => {
        setSelectedIndex((i) => Math.max(i - 1, 0));
    }, []);

    const selectFirst = useCallback(() => setSelectedIndex(0), []);
    const selectLast = useCallback(() => setSelectedIndex(ids.length - 1), [ids.length]);

    useEffect(() => {
        registerTaskListScope({
            kind: 'taskList',
            selectNext,
            selectPrev,
            selectFirst,
            selectLast,
            editSelected: vi.fn(),
            toggleDoneSelected: vi.fn(),
            deleteSelected: vi.fn(),
        });
        return () => registerTaskListScope(null);
    }, [registerTaskListScope, selectNext, selectPrev, selectFirst, selectLast]);

    return (
        <div>
            {ids.map((id, index) => (
                <div key={id} data-task-id={id} className={index === selectedIndex ? 'ring-2' : ''}>
                    Task {id}
                </div>
            ))}
        </div>
    );
};

describe('KeybindingProvider (vim)', () => {
    beforeEach(() => {
        useUiStore.setState({ editingTaskId: null });
    });

    it('moves selection with j/k', async () => {
        render(
            <LanguageProvider>
                <KeybindingProvider currentView="inbox" onNavigate={vi.fn()}>
                    <DummyList />
                </KeybindingProvider>
            </LanguageProvider>
        );

        const first = document.querySelector('[data-task-id="1"]');
        const second = document.querySelector('[data-task-id="2"]');

        expect(first?.className).toMatch(/ring-2/);
        expect(second?.className).not.toMatch(/ring-2/);

        await waitFor(() => {
            expect(document.querySelector('[data-task-id="1"]')?.className).toMatch(/ring-2/);
        });

        fireEvent.keyDown(window, { key: 'j' });

        await waitFor(() => {
            expect(document.querySelector('[data-task-id="2"]')?.className).toMatch(/ring-2/);
        });
    });

    it('triggers quick add with Ctrl+Alt+M', () => {
        const quickAddListener = vi.fn();
        window.addEventListener('mindwtr:quick-add', quickAddListener);

        render(
            <LanguageProvider>
                <KeybindingProvider currentView="inbox" onNavigate={vi.fn()}>
                    <DummyList />
                </KeybindingProvider>
            </LanguageProvider>
        );

        fireEvent.keyDown(window, { key: 'm', code: 'KeyM', ctrlKey: true, altKey: true });

        expect(quickAddListener).toHaveBeenCalledTimes(1);
        window.removeEventListener('mindwtr:quick-add', quickAddListener);
    });

    it('opens settings with Cmd+,', () => {
        const onNavigate = vi.fn();
        render(
            <LanguageProvider>
                <KeybindingProvider currentView="inbox" onNavigate={onNavigate}>
                    <DummyList />
                </KeybindingProvider>
            </LanguageProvider>
        );

        fireEvent.keyDown(window, { key: ',', code: 'Comma', metaKey: true });

        expect(onNavigate).toHaveBeenCalledWith('settings');
    });

    it('dispatches global edit cancel on Escape while editing', () => {
        const cancelListener = vi.fn();
        window.addEventListener('mindwtr:cancel-task-edit', cancelListener);
        useUiStore.setState({ editingTaskId: 'task-123' });

        render(
            <LanguageProvider>
                <KeybindingProvider currentView="inbox" onNavigate={vi.fn()}>
                    <DummyList />
                </KeybindingProvider>
            </LanguageProvider>
        );

        fireEvent.keyDown(window, { key: 'Escape' });

        expect(cancelListener).toHaveBeenCalledTimes(1);
        const event = cancelListener.mock.calls[0]?.[0] as CustomEvent<{ taskId: string }>;
        expect(event.detail.taskId).toBe('task-123');
        window.removeEventListener('mindwtr:cancel-task-edit', cancelListener);
    });
});
