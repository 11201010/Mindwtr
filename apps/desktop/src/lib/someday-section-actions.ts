import { flushPendingSave, sortViewSectionDefinitions, useTaskStore } from '@mindwtr/core';

import { useUiStore } from '../store/ui-store';

const makeSomedaySectionId = () => globalThis.crypto?.randomUUID?.()
    ?? `someday-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// A failed first-section save leaves the definition optimistic in the store.
// Keep its id until recovery completes so retry finishes that same creation.
let pendingFirstSectionId: string | null = null;

function enableGroupingAfterFirstSectionSave(wasFirstCreation: boolean): void {
    const latestSections = sortViewSectionDefinitions(useTaskStore.getState().settings?.gtd?.viewSections?.someday);
    const firstCreationRecovered = pendingFirstSectionId !== null
        && latestSections.some((section) => section.id === pendingFirstSectionId);
    if (!wasFirstCreation && !firstCreationRecovered) {
        pendingFirstSectionId = null;
        return;
    }
    const uiState = useUiStore.getState();
    if (uiState.listOptions.somedayGroupBy === 'none') {
        uiState.setListOptions({ somedayGroupBy: 'viewSection' });
    }
    pendingFirstSectionId = null;
}

async function ensureCatalogueSaved(): Promise<void> {
    const state = useTaskStore.getState();
    // A terminal flush can exhaust its queue while keeping an optimistic
    // definition in settings. A plain second flush would return empty; the
    // store's recovery path re-enqueues its current snapshot before flushing.
    if (state.persistenceFailure) await state.retryPersistence();
    else await flushPendingSave();
}

/**
 * The one desktop write path for creating a Someday catalogue section.
 * Reads both stores at commit time so every picker sees the latest catalogue,
 * and so a grouping choice made while persistence is pending still wins.
 */
export async function createSomedaySection(title: string): Promise<string | null> {
    const trimmed = title.trim();
    if (!trimmed) return null;

    const taskState = useTaskStore.getState();
    const settings = taskState.settings;
    const currentSections = sortViewSectionDefinitions(settings?.gtd?.viewSections?.someday);
    const existing = currentSections.find(
        (section) => section.title.toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) {
        await ensureCatalogueSaved();
        enableGroupingAfterFirstSectionSave(false);
        return existing.id;
    }

    const id = makeSomedaySectionId();
    const maxOrder = currentSections.reduce(
        (maximum, section) => Number.isFinite(section.order) ? Math.max(maximum, section.order) : maximum,
        -1,
    );
    await taskState.updateSettings({
        gtd: {
            ...(settings?.gtd ?? {}),
            viewSections: {
                ...(settings?.gtd?.viewSections ?? {}),
                someday: [...currentSections, { id, title: trimmed, order: maxOrder + 1 }],
            },
        },
    });
    const wasFirstCreation = currentSections.length === 0;
    if (wasFirstCreation) pendingFirstSectionId = id;
    await ensureCatalogueSaved();
    enableGroupingAfterFirstSectionSave(wasFirstCreation);
    return id;
}
