/**
 * The Mind Sweep screen (#677) as React Native shows it: the intro with its scope
 * choice, one cue list at a time with the items captured in it, and the summary.
 * Mobile's mind-sweep-modal-content.tsx renders this model, and the native host
 * contract serves it (native-host-contract-mind-sweep.ts). The screen's state
 * (the scope, the step and what was captured) lives with the screen while it is
 * open; each capture is its own Inbox task, added by the screen.
 */
import { getMindSweepGroups, type MindSweepScope } from './mind-sweep';

type Translate = (key: string) => string;

/** The step before the first cue list; a step past the last one is the summary. */
export const MIND_SWEEP_INTRO_STEP = -1;
export const MIND_SWEEP_SCOPES: readonly MindSweepScope[] = ['all', 'personal', 'work'];

/** What the open screen keeps: its scope, its step, and the titles captured in each cue list (by group ID). */
export type MindSweepState = {
    scope: MindSweepScope;
    step: number;
    captured: Record<string, string[]>;
};

export const INITIAL_MIND_SWEEP_STATE: MindSweepState = { scope: 'all', step: MIND_SWEEP_INTRO_STEP, captured: {} };

export type MindSweepView = {
    title: string;
    closeLabel: string;
    phase: 'intro' | 'group' | 'summary';
    /** Before the first cue list: choose a scope, then Start goes to step `start.step`. */
    intro: {
        text: string;
        scopeLabel: string;
        scopes: { value: MindSweepScope; label: string; selected: boolean }[];
        start: { label: string; step: number };
    } | null;
    group: {
        id: string;
        title: string;
        /** "2 of 9". */
        progress: string;
        prompts: string[];
        placeholder: string;
        /** Add captures the trimmed draft; disabled while the draft is blank. */
        add: { label: string; disabled: boolean };
        /** Shown after a capture the store refused; the draft stays for a retry. */
        addFailed: string | null;
        /** The titles captured in this cue list so far; null before the first. */
        captured: { label: string; items: string[] } | null;
        back: { label: string; disabled: boolean; step: number };
        next: { label: string; step: number };
    } | null;
    summary: { title: string; message: string; hint: string | null; finishLabel: string } | null;
    capturedCount: number;
};

/** The title Add captures: the trimmed draft, or null when there is nothing to capture. */
export function getMindSweepCaptureTitle(draft: string): string | null {
    const title = draft.trim();
    return title ? title : null;
}

/** The captures after `title` landed in the cue list `groupId`. */
export function addMindSweepCapture(captured: Record<string, string[]>, groupId: string, title: string): Record<string, string[]> {
    return { ...captured, [groupId]: [...(captured[groupId] ?? []), title] };
}

export function buildMindSweepView(input: {
    state: MindSweepState;
    /** The capture box's text. */
    draft: string;
    /** The last Add was refused or failed. */
    addFailed: boolean;
    t: Translate;
}): MindSweepView {
    const { state, t } = input;
    const groups = getMindSweepGroups(state.scope);
    const isIntro = state.step === MIND_SWEEP_INTRO_STEP;
    const isSummary = state.step >= groups.length;
    const group = !isIntro && !isSummary ? groups[state.step] ?? null : null;
    const capturedCount = Object.values(state.captured).reduce((sum, items) => sum + items.length, 0);
    const captured = group ? state.captured[group.id] ?? [] : [];
    return {
        title: t('mindSweep.title'),
        closeLabel: t('mindSweep.close'),
        phase: isIntro ? 'intro' : isSummary ? 'summary' : 'group',
        intro: isIntro ? {
            text: t('mindSweep.intro'),
            scopeLabel: t('mindSweep.scopeLabel'),
            scopes: [
                { value: 'all' as const, label: t('mindSweep.scopeAll') },
                { value: 'personal' as const, label: t('mindSweep.scopePersonal') },
                { value: 'work' as const, label: t('mindSweep.scopeWork') },
            ].map((option) => ({ ...option, selected: state.scope === option.value })),
            start: { label: t('mindSweep.start'), step: 0 },
        } : null,
        group: group ? {
            id: group.id,
            title: t(group.titleKey),
            progress: t('mindSweep.progress')
                .replace('{{current}}', String(state.step + 1))
                .replace('{{total}}', String(groups.length)),
            prompts: group.promptKeys.map((key) => t(key)),
            placeholder: t('mindSweep.inputPlaceholder'),
            add: { label: t('mindSweep.add'), disabled: !input.draft.trim() },
            addFailed: input.addFailed ? t('task.addFailed') : null,
            captured: captured.length > 0 ? { label: t('mindSweep.groupCaptured'), items: captured } : null,
            back: { label: t('mindSweep.back'), disabled: state.step === 0, step: state.step - 1 },
            next: { label: t('mindSweep.next'), step: state.step + 1 },
        } : null,
        summary: isSummary ? {
            title: t('mindSweep.summaryTitle'),
            message: capturedCount > 0
                ? t('mindSweep.summaryCount').replace('{{count}}', String(capturedCount))
                : t('mindSweep.summaryEmpty'),
            hint: capturedCount > 0 ? t('mindSweep.summaryHint') : null,
            finishLabel: t('mindSweep.finish'),
        } : null,
        capturedCount,
    };
}
