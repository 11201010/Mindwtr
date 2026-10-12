import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { initializeSandboxRuntime, useTaskStore, type Task } from '@mindwtr/core';
import { LanguageProvider } from '../../contexts/language-context';
import { beginRendererNavigation } from '../../lib/renderer-navigation-diagnostics';
import { setNativeInvokeTransport } from '../../lib/tauri-invoke';
import { BoardView } from './BoardView';
import { TimelineView } from './TimelineView';

const append = vi.fn((_command: string, _args?: Record<string, unknown>) => {});
const work = (activity: string) => append.mock.calls.map(([, args]) => JSON.parse(args!.line as string).context)
    .filter((context) => context.activity === activity);
let width: number;
let resize: ResizeObserverCallback;
const disconnect = vi.fn();

beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    initializeSandboxRuntime(true);
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    setNativeInvokeTransport(async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
        append(command, args);
        return undefined as T;
    });
    useTaskStore.setState({ tasks: [], projects: [], areas: [], sections: [], _allTasks: [], _allProjects: [], _allAreas: [], settings: { diagnostics: { loggingEnabled: true } } });
    width = 900;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback: ResizeObserverCallback) { resize = callback; }
        observe() {}
        unobserve() {}
        disconnect = disconnect;
    });
});

afterEach(() => {
    cleanup();
    append.mockClear();
    disconnect.mockClear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    setNativeInvokeTransport(null);
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: undefined });
});

const renderBoard = () => render(<LanguageProvider><BoardView /></LanguageProvider>);
const renderTimeline = () => {
    const tasks: Task[] = [{ id: 'private-task-id', title: 'private task content', status: 'next', tags: [], contexts: [], createdAt: '1999-01-01', updatedAt: '1999-01-01', dueDate: '2026-10-12' }];
    useTaskStore.setState({ tasks, _allTasks: tasks });
    return render(<LanguageProvider><TimelineView /></LanguageProvider>);
};

describe('renderer view work through real effect lifetimes and native log sanitization', () => {
    it('distinguishes Board timer firing from its resultant React commit and owns later cleanup', () => {
        const owner = beginRendererNavigation('board');
        const view = renderBoard();
        expect(work('board-sequential').map((entry) => entry.stage)).toEqual(['scheduled']);
        act(() => vi.advanceTimersByTime(1));
        expect(work('board-sequential').map((entry) => entry.stage)).toEqual(['scheduled', 'fired', 'committed']);
        expect(work('board-sequential')[2]).toMatchObject({ filteredCountBucket: '0', visibleCountBucket: '0', sequentialProjectCountBucket: '0', sequentialResultCountBucket: '0' });
        const next = beginRendererNavigation('reference');
        view.unmount();
        expect(work('board-sequential').slice(-1)[0]).toMatchObject({ stage: 'cleanup', outcome: 'already-fired', navigationSequence: String(owner.sequence), currentNavigationSequence: String(next.sequence) });
    });

    it('cancels an unmounted Board timer without firing or committing', () => {
        const view = renderBoard();
        view.unmount();
        act(() => vi.advanceTimersByTime(1));
        expect(work('board-sequential').map((entry) => entry.stage)).toEqual(['scheduled', 'cleanup']);
        expect(work('board-sequential').slice(-1)[0]?.outcome).toBe('cancelled');
    });

    it('separates cancelled and live Board activities on React effect replay', () => {
        const view = render(<StrictMode><LanguageProvider><BoardView /></LanguageProvider></StrictMode>);
        act(() => vi.advanceTimersByTime(1));
        view.unmount();
        const records = work('board-sequential');
        expect(records.map((entry) => entry.stage)).toEqual(['scheduled', 'cleanup', 'scheduled', 'fired', 'committed', 'cleanup']);
        expect(records[1].outcome).toBe('cancelled');
        expect(records[2].activitySequence).not.toBe(records[0].activitySequence);
    });

    it('bounds Timeline observer callbacks, centers after measurement and retains cleanup totals', () => {
        const owner = beginRendererNavigation('timeline');
        const view = renderTimeline();
        expect(work('timeline-measurement').map((entry) => entry.stage)).toEqual(['initial-start', 'initial-end', 'attached']);
        expect(work('timeline-centering').map((entry) => entry.stage)).toEqual(['centering-start', 'centering-end']);
        expect(work('timeline-centering')[0]).toMatchObject({ measured: 'true', todayVisible: 'true', zoom: 'week' });
        for (let count = 0; count < 10; count++) {
            width = 901 + count;
            act(() => resize([], {} as ResizeObserver));
        }
        expect(work('timeline-measurement').filter((entry) => entry.stage === 'callback-start')).toHaveLength(3);
        expect(work('timeline-measurement').filter((entry) => entry.stage === 'callback-end')).toHaveLength(3);
        const next = beginRendererNavigation('board');
        view.unmount();
        expect(disconnect).toHaveBeenCalled();
        expect(work('timeline-measurement').slice(-1)[0]).toMatchObject({ stage: 'cleanup', callbackCount: '10', widthChangeCount: '10', navigationSequence: String(owner.sequence), currentNavigationSequence: String(next.sequence) });
        expect(JSON.stringify(work('timeline-measurement'))).not.toMatch(/private|1999|2026|\[redacted\]/);
    });

    it('retains the window resize fallback and suppresses future activity logs after opt-out', () => {
        vi.stubGlobal('ResizeObserver', undefined);
        const view = renderTimeline();
        expect(work('timeline-measurement').slice(-1)[0]?.attachMode).toBe('window-resize');
        width = 1000;
        act(() => window.dispatchEvent(new Event('resize')));
        expect(work('timeline-measurement').filter((entry) => entry.stage === 'callback-end')).toHaveLength(1);
        act(() => useTaskStore.setState({ settings: { diagnostics: { loggingEnabled: false } } }));
        const before = append.mock.calls.length;
        act(() => window.dispatchEvent(new Event('resize')));
        view.unmount();
        window.dispatchEvent(new Event('resize'));
        expect(append.mock.calls).toHaveLength(before);
    });

    it('appends no Board or Timeline work logs when debug logging is disabled', () => {
        useTaskStore.setState({ settings: { diagnostics: { loggingEnabled: false } } });
        const board = renderBoard();
        act(() => vi.advanceTimersByTime(1));
        board.unmount();
        const timeline = renderTimeline();
        act(() => resize([], {} as ResizeObserver));
        timeline.unmount();
        expect(append).not.toHaveBeenCalled();
    });
});
