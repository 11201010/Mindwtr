import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import type { AppData, Task, TimeEstimate } from '@mindwtr/core';
import { createAIProvider } from '@mindwtr/core';
import type { AIProviderId } from '@mindwtr/core';
import { buildCopilotConfig, loadAIKey } from '../../lib/ai-config';
import { logError } from '../../lib/app-log';

type CopilotSuggestion = {
    context?: string;
    timeEstimate?: TimeEstimate;
    tags?: string[];
};

type UseTaskEditCopilotArgs = {
    settings: AppData['settings'];
    aiEnabled: boolean;
    aiProvider: AIProviderId;
    timeEstimatesEnabled: boolean;
    titleDraft: string;
    descriptionDraft: string;
    contextOptions: string[];
    tagOptions: string[];
    editedTask: Partial<Task>;
    visible: boolean;
    setEditedTask: (value: SetStateAction<Partial<Task>>, markDirty?: boolean) => void;
};

export function useTaskEditCopilot({
    settings,
    aiEnabled,
    aiProvider,
    timeEstimatesEnabled,
    titleDraft,
    descriptionDraft,
    contextOptions,
    tagOptions,
    editedTask,
    visible,
    setEditedTask,
}: UseTaskEditCopilotArgs) {
    const [aiKey, setAiKey] = useState('');
    const [copilotSuggestion, setCopilotSuggestion] = useState<CopilotSuggestion | null>(null);
    const [copilotApplied, setCopilotApplied] = useState(false);
    const [copilotContext, setCopilotContext] = useState<string | undefined>(undefined);
    const [copilotEstimate, setCopilotEstimate] = useState<TimeEstimate | undefined>(undefined);
    const [copilotTags, setCopilotTags] = useState<string[]>([]);
    const [showAllContexts, setShowAllContexts] = useState(false);
    const [showAllTags, setShowAllTags] = useState(false);
    const copilotMountedRef = useRef(true);
    const copilotAbortRef = useRef<AbortController | null>(null);
    const contextOptionsRef = useRef<string[]>([]);
    const tagOptionsRef = useRef<string[]>([]);

    useEffect(() => {
        Promise.resolve()
            .then(() => loadAIKey(aiProvider))
            .then((value) => {
                setAiKey(typeof value === 'string' ? value : '');
            })
            .catch((error) => {
                void logError(error, { scope: 'ai', extra: { message: 'Failed to load AI key' } });
                setAiKey('');
            });
    }, [aiProvider]);

    useEffect(() => {
        copilotMountedRef.current = true;
        return () => {
            copilotMountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        contextOptionsRef.current = contextOptions;
        tagOptionsRef.current = tagOptions;
    }, [contextOptions, tagOptions]);

    useEffect(() => {
        if (!aiEnabled || !aiKey) {
            setCopilotSuggestion(null);
            return;
        }
        const title = String(titleDraft ?? '').trim();
        const description = String(descriptionDraft ?? '').trim();
        const input = [title, description].filter(Boolean).join('\n');
        if (input.length < 4) {
            setCopilotSuggestion(null);
            return;
        }
        let cancelled = false;
        let localAbortController: AbortController | null = null;
        const handle = setTimeout(async () => {
            const abortController = typeof AbortController === 'function' ? new AbortController() : null;
            localAbortController = abortController;
            const previousController = copilotAbortRef.current;
            if (abortController) {
                copilotAbortRef.current = abortController;
            }
            if (previousController) {
                previousController.abort();
            }
            try {
                const provider = createAIProvider(buildCopilotConfig(settings, aiKey));
                const suggestion = await provider.predictMetadata(
                    { title: input, contexts: contextOptionsRef.current, tags: tagOptionsRef.current },
                    abortController ? { signal: abortController.signal } : undefined
                );
                if (cancelled || !copilotMountedRef.current) return;
                if (!suggestion.context && (!timeEstimatesEnabled || !suggestion.timeEstimate) && !suggestion.tags?.length) {
                    setCopilotSuggestion(null);
                } else {
                    setCopilotSuggestion(suggestion);
                }
            } catch {
                if (!cancelled && copilotMountedRef.current) setCopilotSuggestion(null);
            }
        }, 800);
        return () => {
            cancelled = true;
            clearTimeout(handle);
            if (copilotAbortRef.current && copilotAbortRef.current === localAbortController) {
                copilotAbortRef.current.abort();
                copilotAbortRef.current = null;
            }
        };
    }, [aiEnabled, aiKey, titleDraft, descriptionDraft, settings, timeEstimatesEnabled]);

    useEffect(() => {
        if (!visible) {
            setCopilotSuggestion(null);
            setCopilotApplied(false);
            setCopilotContext(undefined);
            setCopilotEstimate(undefined);
            setCopilotTags([]);
            if (copilotAbortRef.current) {
                copilotAbortRef.current.abort();
                copilotAbortRef.current = null;
            }
        }
    }, [visible]);

    const resetCopilotDraft = useCallback(() => {
        setCopilotApplied(false);
        setCopilotContext(undefined);
        setCopilotEstimate(undefined);
        setCopilotTags([]);
    }, []);

    const resetCopilotState = useCallback(() => {
        setCopilotSuggestion(null);
        setCopilotApplied(false);
        setCopilotContext(undefined);
        setCopilotEstimate(undefined);
        setCopilotTags([]);
    }, []);

    const applyCopilotSuggestion = useCallback(() => {
        if (!copilotSuggestion) return;
        if (copilotSuggestion.context) {
            const current = editedTask.contexts ?? [];
            const next = Array.from(new Set([...current, copilotSuggestion.context]));
            setEditedTask((prev) => ({ ...prev, contexts: next }));
            setCopilotContext(copilotSuggestion.context);
        }
        if (copilotSuggestion.tags?.length) {
            const currentTags = editedTask.tags ?? [];
            const nextTags = Array.from(new Set([...currentTags, ...copilotSuggestion.tags]));
            setEditedTask((prev) => ({ ...prev, tags: nextTags }));
            setCopilotTags(copilotSuggestion.tags);
        }
        if (copilotSuggestion.timeEstimate && timeEstimatesEnabled) {
            setEditedTask((prev) => ({ ...prev, timeEstimate: copilotSuggestion.timeEstimate }));
            setCopilotEstimate(copilotSuggestion.timeEstimate);
        }
        setCopilotApplied(true);
    }, [copilotSuggestion, editedTask.contexts, editedTask.tags, setEditedTask, timeEstimatesEnabled]);

    return {
        aiKey,
        copilotSuggestion,
        copilotApplied,
        copilotContext,
        copilotEstimate,
        copilotTags,
        showAllContexts,
        setShowAllContexts,
        showAllTags,
        setShowAllTags,
        resetCopilotDraft,
        resetCopilotState,
        applyCopilotSuggestion,
    };
}
