import { useMemo } from 'react';
import {
    getFrequentTaskTokensFromUsage,
    getTaskEditorTokenMatches,
    getTaskEditorTokenPool,
    TASK_EDITOR_QUICK_TOKEN_LIMIT,
    type TaskTokenUsage,
} from '@mindwtr/core';
import { MAX_VISIBLE_SUGGESTIONS } from './recurrence-utils';
import { getActiveTokenQuery, parseTokenList } from './task-edit-token-utils';

type UseTaskTokenSuggestionsParams = {
    editedContexts?: string[];
    editedTags?: string[];
    contextInputDraft: string;
    tagInputDraft: string;
    allContexts: string[];
    allTags: string[];
    contextTokenUsage: TaskTokenUsage[];
    tagTokenUsage: TaskTokenUsage[];
};

export const useTaskTokenSuggestions = ({
    editedContexts,
    editedTags,
    contextInputDraft,
    tagInputDraft,
    allContexts,
    allTags,
    contextTokenUsage,
    tagTokenUsage,
}: UseTaskTokenSuggestionsParams) => {
    const contextSuggestionPool = useMemo(
        () => getTaskEditorTokenPool(editedContexts, allContexts, '@'),
        [allContexts, editedContexts]
    );

    const tagSuggestionPool = useMemo(
        () => getTaskEditorTokenPool(editedTags, allTags, '#'),
        [allTags, editedTags]
    );

    const contextTokenQuery = useMemo(
        () => getActiveTokenQuery(contextInputDraft, '@'),
        [contextInputDraft]
    );
    const tagTokenQuery = useMemo(
        () => getActiveTokenQuery(tagInputDraft, '#'),
        [tagInputDraft]
    );

    const contextTokenSuggestions = useMemo(
        () => getTaskEditorTokenMatches(contextSuggestionPool, contextInputDraft, '@', MAX_VISIBLE_SUGGESTIONS),
        [contextInputDraft, contextSuggestionPool]
    );

    const tagTokenSuggestions = useMemo(
        () => getTaskEditorTokenMatches(tagSuggestionPool, tagInputDraft, '#', MAX_VISIBLE_SUGGESTIONS),
        [tagInputDraft, tagSuggestionPool]
    );

    const frequentContextSuggestions = useMemo(
        () => getFrequentTaskTokensFromUsage(contextTokenUsage, TASK_EDITOR_QUICK_TOKEN_LIMIT),
        [contextTokenUsage]
    );

    const frequentTagSuggestions = useMemo(
        () => getFrequentTaskTokensFromUsage(tagTokenUsage, TASK_EDITOR_QUICK_TOKEN_LIMIT),
        [tagTokenUsage]
    );

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
