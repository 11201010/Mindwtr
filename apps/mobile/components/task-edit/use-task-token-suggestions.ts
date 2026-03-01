import { useMemo } from 'react';
import type { Task } from '@mindwtr/core';
import { PRESET_TAGS } from '@mindwtr/core';
import { QUICK_TOKEN_LIMIT } from './task-edit-modal.utils';
import { MAX_VISIBLE_SUGGESTIONS } from './recurrence-utils';
import { getActiveTokenQuery, parseTokenList } from './task-edit-token-utils';

type UseTaskTokenSuggestionsParams = {
    tasks: Task[];
    editedContexts?: string[];
    editedTags?: string[];
    contextInputDraft: string;
    tagInputDraft: string;
    suggestedContexts: string[];
};

export const useTaskTokenSuggestions = ({
    tasks,
    editedContexts,
    editedTags,
    contextInputDraft,
    tagInputDraft,
    suggestedContexts,
}: UseTaskTokenSuggestionsParams) => {
    const contextSuggestionPool = useMemo(() => {
        const taskContexts = tasks.flatMap((item) => item.contexts || []);
        return Array.from(new Set([...(editedContexts ?? []), ...taskContexts]))
            .filter((item): item is string => Boolean(item?.startsWith('@')));
    }, [editedContexts, tasks]);

    const tagSuggestionPool = useMemo(() => {
        const taskTags = tasks.flatMap((item) => item.tags || []);
        return Array.from(new Set([...(editedTags ?? []), ...taskTags]))
            .filter((item): item is string => Boolean(item?.startsWith('#')));
    }, [editedTags, tasks]);

    const contextTokenQuery = useMemo(
        () => getActiveTokenQuery(contextInputDraft, '@'),
        [contextInputDraft]
    );
    const tagTokenQuery = useMemo(
        () => getActiveTokenQuery(tagInputDraft, '#'),
        [tagInputDraft]
    );

    const contextTokenSuggestions = useMemo(() => {
        if (!contextTokenQuery) return [];
        const selected = new Set(parseTokenList(contextInputDraft, '@'));
        return contextSuggestionPool
            .filter((token) => token.slice(1).toLowerCase().includes(contextTokenQuery))
            .filter((token) => !selected.has(token))
            .slice(0, MAX_VISIBLE_SUGGESTIONS);
    }, [contextInputDraft, contextSuggestionPool, contextTokenQuery]);

    const tagTokenSuggestions = useMemo(() => {
        if (!tagTokenQuery) return [];
        const selected = new Set(parseTokenList(tagInputDraft, '#'));
        return tagSuggestionPool
            .filter((token) => token.slice(1).toLowerCase().includes(tagTokenQuery))
            .filter((token) => !selected.has(token))
            .slice(0, MAX_VISIBLE_SUGGESTIONS);
    }, [tagInputDraft, tagSuggestionPool, tagTokenQuery]);

    const frequentContextSuggestions = useMemo(
        () => suggestedContexts.slice(0, QUICK_TOKEN_LIMIT),
        [suggestedContexts]
    );

    const frequentTagSuggestions = useMemo(() => {
        const counts = new Map<string, number>();
        tasks.forEach((item) => {
            item.tags?.forEach((tag) => {
                if (!tag?.startsWith('#')) return;
                counts.set(tag, (counts.get(tag) || 0) + 1);
            });
        });
        const sorted = Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([tag]) => tag);
        return Array.from(new Set([...sorted, ...PRESET_TAGS])).slice(0, QUICK_TOKEN_LIMIT);
    }, [tasks]);

    const selectedContextTokens = useMemo(
        () => new Set(parseTokenList(contextInputDraft, '@')),
        [contextInputDraft]
    );
    const selectedTagTokens = useMemo(
        () => new Set(parseTokenList(tagInputDraft, '#')),
        [tagInputDraft]
    );

    return {
        contextSuggestionPool,
        tagSuggestionPool,
        contextTokenQuery,
        tagTokenQuery,
        contextTokenSuggestions,
        tagTokenSuggestions,
        frequentContextSuggestions,
        frequentTagSuggestions,
        selectedContextTokens,
        selectedTagTokens,
    };
};
