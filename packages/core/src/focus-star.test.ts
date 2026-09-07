import { describe, expect, it } from 'vitest';
import type { Task } from './types';
import {
    canStarNewCapture,
    getFocusStarBlockedText,
    resolveFocusStarAction,
    resolveTaskFocusCreation,
    type FocusStarContext,
} from './focus-star';

const makeTask = (overrides: Partial<Task>): Task => ({
    id: 'task-1',
    title: 'Task',
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
});

const baseContext = (overrides: Partial<FocusStarContext> = {}): FocusStarContext => ({
    tasks: [],
    projects: [],
    sections: [],
    focusedCount: 0,
    focusTaskLimit: 3,
    ...overrides,
});

describe('resolveFocusStarAction', () => {
    it('allows starring an eligible next task under the cap', () => {
        const action = resolveFocusStarAction(makeTask({}), baseContext());
        expect(action).toMatchObject({
            isFocused: false,
            canToggle: true,
            blockedReason: null,
            labelKey: 'agenda.addToFocus',
            patch: { isFocusedToday: true },
        });
    });

    it('always allows removing a star, even over the cap', () => {
        const action = resolveFocusStarAction(
            makeTask({ isFocusedToday: true }),
            baseContext({ focusedCount: 5, focusTaskLimit: 3 }),
        );
        expect(action).toMatchObject({
            canToggle: true,
            blockedReason: null,
            labelKey: 'agenda.removeFromFocus',
            patch: { isFocusedToday: false },
        });
    });

    it('blocks unclarified tasks unless the surface allows them', () => {
        const inboxTask = makeTask({ status: 'inbox' });
        expect(resolveFocusStarAction(inboxTask, baseContext()).blockedReason).toBe('clarify');
        expect(
            resolveFocusStarAction(inboxTask, baseContext({ allowUnclarified: true })).canToggle,
        ).toBe(true);
    });

    it('blocks at the focus cap', () => {
        const action = resolveFocusStarAction(makeTask({}), baseContext({ focusedCount: 3 }));
        expect(action).toMatchObject({ canToggle: false, blockedReason: 'limit' });
    });

    it('blocks deferred tasks with the deferred reason', () => {
        const deferred = makeTask({ startTime: '2099-01-01T00:00:00.000Z' });
        const action = resolveFocusStarAction(deferred, baseContext());
        expect(action).toMatchObject({ canToggle: false, blockedReason: 'deferred' });
    });
});

describe('getFocusStarBlockedText', () => {
    const passthrough = (key: string) => key;

    it('interpolates the focus limit into the cap message', () => {
        const text = getFocusStarBlockedText(
            () => 'Max {{count}} focus items.',
            { blockedReason: 'limit' },
            5,
        );
        expect(text).toBe('Max 5 focus items.');
    });

    it('falls back to English per reason and returns null when unblocked', () => {
        expect(getFocusStarBlockedText(passthrough, { blockedReason: 'clarify' }, 3))
            .toBe('Clarify this task before adding it to Focus.');
        expect(getFocusStarBlockedText((key) => (key === 'agenda.focusUnavailableSequential' ? 'Übersetzt' : key), { blockedReason: 'sequential' }, 3))
            .toBe('Übersetzt');
        expect(getFocusStarBlockedText(passthrough, { blockedReason: null }, 3)).toBeNull();
    });
});

describe('canStarNewCapture', () => {
    it('gates only on the cap', () => {
        expect(canStarNewCapture({ focusedCount: 2, focusTaskLimit: 3 })).toBe(true);
        expect(canStarNewCapture({ focusedCount: 3, focusTaskLimit: 3 })).toBe(false);
    });
});

describe('resolveTaskFocusCreation', () => {
    it('promotes an eligible starred Inbox capture only when the star lands', () => {
        const decision = resolveTaskFocusCreation(
            makeTask({ status: 'inbox', isFocusedToday: true }),
            baseContext(),
        );

        expect(decision).toEqual({
            status: 'next',
            isFocusedToday: true,
            outcome: 'focused',
        });
    });

    it('refuses a full-cap star without changing the requested status', () => {
        const context = baseContext({ focusedCount: 3, focusTaskLimit: 3 });

        expect(resolveTaskFocusCreation(
            makeTask({ status: 'inbox', isFocusedToday: true }),
            context,
        )).toEqual({
            status: 'inbox',
            isFocusedToday: false,
            outcome: 'refused-limit',
        });
        expect(resolveTaskFocusCreation(
            makeTask({ status: 'next', isFocusedToday: true }),
            context,
        )).toEqual({
            status: 'next',
            isFocusedToday: false,
            outcome: 'refused-limit',
        });
    });

    it('refuses an ineligible star and preserves eligible review-due statuses', () => {
        expect(resolveTaskFocusCreation(
            makeTask({ status: 'next', isFocusedToday: true, startTime: '2099-01-01' }),
            baseContext(),
        )).toEqual({
            status: 'next',
            isFocusedToday: false,
            outcome: 'refused-ineligible',
        });

        for (const status of ['waiting', 'someday'] as const) {
            expect(resolveTaskFocusCreation(
                makeTask({ status, isFocusedToday: true, reviewAt: '2020-01-01' }),
                baseContext(),
            )).toEqual({
                status,
                isFocusedToday: true,
                outcome: 'focused',
            });
        }
    });
});
