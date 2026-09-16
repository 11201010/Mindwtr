import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTEXTS_VIEW_STATE, NO_CONTEXT_TOKEN, sanitizeContextsViewState } from './contexts-view-state';

describe('contexts view state', () => {
    it('migrates a single-token preference and defaults to Match All', () => {
        expect(sanitizeContextsViewState({ selectedContext: '@work' }, DEFAULT_CONTEXTS_VIEW_STATE))
            .toMatchObject({ selectedContexts: ['@work'], matchMode: 'all' });
    });

    it('deduplicates selected tokens and keeps No context exclusive', () => {
        expect(sanitizeContextsViewState({
            selectedContexts: ['@work', '@work', '#home'], matchMode: 'any',
        }, DEFAULT_CONTEXTS_VIEW_STATE)).toMatchObject({
            selectedContexts: ['@work', '#home'], matchMode: 'any',
        });
        expect(sanitizeContextsViewState({
            selectedContexts: ['@work', NO_CONTEXT_TOKEN], matchMode: 'any',
        }, DEFAULT_CONTEXTS_VIEW_STATE).selectedContexts).toEqual([NO_CONTEXT_TOKEN]);
    });
});
