/**
 * The native host contract for outside entry points: what a link, an Android text share, an assistant note, or the
 * capture popup's Import .txt opens. Kept in its own file and spread into createNativeHostContract. Kotlin reads the
 * intent (its data, its text extras, the picked file's text) and opens what this names; every rule is core's:
 * React Native's system-path rules and its root layout's capture, share and entity handling (entry-points.ts,
 * capture-deeplink.ts), and the capture popup's import (quick-capture-model.ts).
 *
 * Where React Native opens its capture confirmation screen (capture-modal.tsx: a capture link, a share, an assistant
 * note, a widget's quick capture), the native app opens its capture popup: the title is the popup's text and the
 * description its note. The popup has no tag or project-name option, so a capture link's tags, and a project name no
 * project carries, go at the end of the text as quick-add tokens, which the popup's own parser saves as React Native
 * saves them (a new project for an unknown name).
 *
 * Only functions read this module's imports from native-host-contract.ts, so the import cycle between the two files
 * is safe.
 */
import {
    normalizeShortcutTags,
    parseEntityOpenUrl,
    parseShortcutCaptureUrl,
    type ShortcutCapturePayload,
} from './capture-deeplink';
import {
    buildCreateNoteCapture,
    buildShareCaptureDraft,
    readAndroidTextShare,
    resolveEntityOpenTarget,
    resolveSystemPath,
} from './entry-points';
import { DEFAULT_GLOBAL_SEARCH_FILTERS, type GlobalSearchFilterState } from './global-search-model';
import { tFallback, type TranslateFn } from './i18n';
import { NATIVE_HOST_CONTRACT_VERSION, type NativeHostResult } from './native-host-contract';
import { fail, isObjectRecord, isText } from './native-host-contract-menu-views';
import { isSelectableProjectForTaskAssignment } from './project-utils';
import { splitQuickAddBulkLines } from './quick-add';
import {
    createQuickCaptureOptions,
    getQuickCaptureBulkConfirm,
    resolveQuickCaptureDefaultAreaId,
    type QuickCaptureNotice,
    type QuickCaptureOptions,
} from './quick-capture-model';
import { isSandboxMode } from './sandbox';
import { useTaskStore } from './store';

type EntryPointDeps = {
    readiness: () => NativeHostResult<null>;
    t: () => TranslateFn;
};

/** A link's whole URL and the app's own scheme; a text share's EXTRA_TEXT, EXTRA_TITLE and EXTRA_SUBJECT; an assistant note's name and text extras. */
export type NativeEntryPointInput =
    | { kind: 'link'; url: string; scheme: string }
    | { kind: 'share'; text: string | null; title: string | null; subject: string | null }
    | { kind: 'createNote'; name: string | null; text: string | null; extraText: string | null };

export type NativeEntryPoint = {
    version: typeof NATIVE_HOST_CONTRACT_VERSION;
    /**
     * React Native's route the entry goes to (Expo Router's path: '/inbox', '/focus', '/projects', '/projects-screen',
     * '/waiting', '/someday', '/review-tab', '/calendar', '/global-search', '/settings', or any other path a link names).
     * Null: the app stays where it is.
     */
    route: string | null;
    /** A task to open in the editor over the route, on its View tab, and outline on its row (React Native's taskId and setHighlightTask). */
    taskId: string | null;
    /** A project to open on React Native's Projects screen. */
    projectId: string | null;
    /** React Native's global search, open with this query and these filters (null: core's defaults). */
    search: { query: string; filters: GlobalSearchFilterState | null } | null;
    /**
     * The capture popup, open with this text and these options. `returnToPreviousApp`: a system capture (a widget's, the
     * tile's, or a shortcut's) puts the app behind the previous one once the popup closes (#1169).
     */
    capture: { text: string; options: QuickCaptureOptions; returnToPreviousApp: boolean } | null;
    /** React Native's toast. */
    notice: QuickCaptureNotice | null;
};

/** The capture popup's Import .txt: ask to create one task per line, put one line in the field, do nothing, or refuse. */
export type NativeQuickCaptureImport =
    /** Ask with this text, then send submitQuickCaptureLines with `text` as the text and one capture ID per line. */
    | { kind: 'confirmLines'; confirm: ReturnType<typeof getQuickCaptureBulkConfirm>; lineCount: number; text: string }
    | { kind: 'setText'; text: string }
    | { kind: 'empty' }
    | { kind: 'refused'; notice: QuickCaptureNotice };

const URL_LIMIT = 16_000;
/** The capture popup's text limit (native-host-contract-quick-capture.ts). */
const TEXT_LIMIT = 100_000;
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]{0,31}$/;
const isOptionalString = (value: unknown): value is string | null => value === null || typeof value === 'string';
const longerThan = (value: string | null, max: number) => (value?.length ?? 0) > max;

/**
 * A quick-add token for [value] with [marker]: bare, or in straight double quotes with backslash escapes (the parser's
 * canonical quoted form) when it holds a space, a quote or a backslash.
 */
const token = (marker: '#' | '+', value: string) => (
    /[\s"\\]/.test(value) ? `${marker}"${value.replace(/["\\]/g, (char) => `\\${char}`)}"` : `${marker}${value}`
);

export function createEntryPointMethods(deps: EntryPointDeps) {
    const opened = (value: Partial<Omit<NativeEntryPoint, 'version'>>): NativeHostResult<NativeEntryPoint> => ({
        ok: true,
        value: { version: NATIVE_HOST_CONTRACT_VERSION, route: null, taskId: null, projectId: null, search: null, capture: null, notice: null, ...value },
    });
    const notice = (titleKey: string, title: string, messageKey: string, message: string): QuickCaptureNotice => ({
        tone: 'warning', title: tFallback(deps.t(), titleKey, title), message: tFallback(deps.t(), messageKey, message),
    });

    /** React Native's toast for a shared item it cannot read. */
    const shareUnreadable = () => notice('share.unavailable', 'Share unavailable',
        'share.readFailed', 'Mindwtr could not read text, a URL, or a file from the shared item.');

    /** The capture popup's fresh options with the entry's note and project, as React Native's popup starts from a preset. */
    const captureOf = (text: string, preset: { description?: string; projectId?: string }, returnToPreviousApp: boolean) => {
        const state = useTaskStore.getState();
        const options = createQuickCaptureOptions({
            initialProps: preset,
            projects: state.projects,
            defaultAreaId: resolveQuickCaptureDefaultAreaId(state.settings, state.areas),
        });
        return { text, options, returnToPreviousApp };
    };

    /**
     * A capture link's payload in the popup: the title, then its tags and a project name no project carries as tokens.
     * The project matches by id or by title (any case), as React Native's capture screen matches it; a matched project
     * that takes no tasks (archived, completed) is skipped, as it skips it.
     */
    const payloadCapture = (payload: ShortcutCapturePayload) => {
        const tags = normalizeShortcutTags(payload.tags).map((tag) => tag.slice(1)).filter(Boolean).map((tag) => token('#', tag));
        let projectId: string | undefined;
        let projectToken: string | null = null;
        const reference = payload.project;
        if (reference) {
            const lower = reference.toLowerCase();
            const match = useTaskStore.getState().projects.find((project) => project.id === reference || project.title.toLowerCase() === lower);
            if (!match) projectToken = token('+', reference);
            else if (isSelectableProjectForTaskAssignment(match)) projectId = match.id;
        }
        const text = [payload.title, ...tags, projectToken].filter(Boolean).join(' ');
        return captureOf(text, { ...(payload.note ? { description: payload.note } : {}), ...(projectId ? { projectId } : {}) }, false);
    };

    /**
     * A link through React Native's system-path rules, then what its root layout opens for it. [scheme] is the app's
     * own (the development build's mindwtr-native-dev); it stands for mindwtr, so the shared rules read the link. A link
     * of another scheme opens nothing.
     */
    const resolveLink = (url: string, scheme: string): NativeHostResult<NativeEntryPoint> => {
        if (url.slice(0, scheme.length + 1).toLowerCase() !== `${scheme}:`) return opened({});
        const path = `mindwtr:${url.slice(scheme.length + 1)}`;
        // React Native's root layout handles no capture, share or entity link in sandbox mode: they stay on the Inbox.
        const sandbox = isSandboxMode();
        const route = resolveSystemPath(path, true);
        switch (route.kind) {
            case 'shareHandoff':
                return opened({});
            case 'dropboxCallback':
                return opened({ route: route.path.split('?')[0] });
            case 'openFeature':
                // The capture feature opens the quick capture popup over the Inbox (the capture-quick route).
                return route.path.startsWith('/capture-quick')
                    ? opened({ route: '/inbox', capture: captureOf('', {}, false) })
                    : opened({ route: route.path });
            case 'entityOpen': {
                const entity = parseEntityOpenUrl(path);
                const target = entity && !sandbox ? resolveEntityOpenTarget(entity.kind, entity.id, useTaskStore.getState()) : null;
                if (!target) return opened({ route: '/inbox' });
                return target.pathname === '/focus'
                    ? opened({ route: '/focus', taskId: target.taskId })
                    : opened({ route: '/projects-screen', projectId: target.projectId ?? null });
            }
            case 'capture': {
                if (sandbox) return opened({ route: '/inbox' });
                const payload = parseShortcutCaptureUrl(path);
                if (!payload) {
                    return opened({
                        route: '/inbox',
                        notice: notice('shortcuts.captureUnavailable', 'Capture shortcut unavailable',
                            'shortcuts.missingTitle', 'Mindwtr could not read a task title from that shortcut link.'),
                    });
                }
                return opened({ route: '/inbox', capture: payloadCapture(payload) });
            }
            case 'quickCapture':
                return opened({ capture: captureOf('', {}, true) });
            case 'path':
                break;
        }
        // Any other link is Expo Router's route by its path (host and path): a list, or the global search with its query.
        let parsed: URL;
        try {
            parsed = new URL(path);
        } catch {
            return opened({ route: '/inbox' });
        }
        const segments = [parsed.hostname, ...parsed.pathname.split('/')].filter(Boolean);
        const target = `/${segments.join('/')}`;
        if (target !== '/global-search') return opened({ route: target });
        const includeCompleted = (parsed.searchParams.get('includeCompleted') ?? '').toLowerCase() === 'true';
        return opened({
            route: target,
            search: {
                query: parsed.searchParams.get('q') ?? '',
                filters: includeCompleted ? { ...DEFAULT_GLOBAL_SEARCH_FILTERS, includeCompleted: true } : null,
            },
        });
    };

    return {
        /**
         * What an entry point opens: a link (VIEW with the app's scheme), a text share (SEND text/plain), or an assistant
         * note (CREATE_NOTE). Nothing is written: a capture opens the popup, and its Save is the popup's own command.
         */
        resolveNativeEntryPoint(input: NativeEntryPointInput): NativeHostResult<NativeEntryPoint> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isObjectRecord(input)) return fail('INVALID_INPUT', 'An entry point is required');
            if (input.kind === 'link') {
                if (!isText(input.url, URL_LIMIT) || typeof input.scheme !== 'string' || !SCHEME_PATTERN.test(input.scheme)) {
                    return fail('INVALID_INPUT', 'A link needs its URL and the app\'s scheme');
                }
                return resolveLink(input.url, input.scheme);
            }
            if (input.kind === 'share') {
                if (!isOptionalString(input.text) || !isOptionalString(input.title) || !isOptionalString(input.subject)) {
                    return fail('INVALID_INPUT', 'A share\'s text, title and subject are text or null');
                }
                // React Native's root layout takes no share in sandbox mode, and the provider reports none without text.
                const share = isSandboxMode() ? null : readAndroidTextShare(input);
                if (!share) return opened({});
                const draft = buildShareCaptureDraft({ shareSubject: share.subject, shareText: share.text, shareWebUrl: share.webUrl });
                // The popup takes at most its text limit (its note five times that); a longer share is one the app cannot
                // read, and says so as React Native does for a share it cannot read.
                if (!draft || draft.title.length > TEXT_LIMIT || longerThan(input.text, TEXT_LIMIT * 5)
                    || longerThan(input.title, TEXT_LIMIT) || longerThan(input.subject, TEXT_LIMIT)) {
                    return opened({ notice: shareUnreadable() });
                }
                return opened({ capture: captureOf(draft.title, draft.description !== undefined ? { description: draft.description } : {}, false) });
            }
            if (input.kind === 'createNote') {
                if (!isOptionalString(input.name) || !isOptionalString(input.text) || !isOptionalString(input.extraText)) {
                    return fail('INVALID_INPUT', 'A note\'s name and text are text or null');
                }
                const payload = buildCreateNoteCapture(input);
                // React Native's root layout handles no capture link and shows no share failure in sandbox mode.
                if (isSandboxMode()) return opened(payload ? { route: '/inbox' } : {});
                // React Native leaves an empty note as it came, and its share reader then refuses the unknown action; a note
                // longer than the popup takes is one this app cannot read either.
                if (!payload || [input.name, input.text, input.extraText].some((value) => longerThan(value, TEXT_LIMIT))) {
                    return opened({ notice: shareUnreadable() });
                }
                return opened({ route: '/inbox', capture: payloadCapture(payload) });
            }
            return fail('INVALID_INPUT', 'An entry point is a link, a share or a note');
        },

        /**
         * The capture popup's Import .txt, as React Native's handleImportTextFile: several lines ask to create one task
         * per line (the popup's Create tasks, with `text` in place of the field's), one line goes into the field, and an
         * empty file does nothing. `text` null: the picked file could not be read. Sandbox mode refuses, as React
         * Native does. Nothing is written.
         */
        planQuickCaptureImport(input: { text: string | null }): NativeHostResult<NativeQuickCaptureImport> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isObjectRecord(input) || (input.text !== null && typeof input.text !== 'string')) {
                return fail('INVALID_INPUT', 'The file\'s text, or null when it could not be read, is required');
            }
            const t = deps.t();
            if (isSandboxMode()) {
                return { ok: true, value: { kind: 'refused', notice: { tone: 'warning', title: t('common.notice'), message: t('sandbox.unavailable'), durationMs: 4200 } } };
            }
            // The popup takes at most its text limit, so a longer file is one this app cannot import.
            if (input.text === null || input.text.length > TEXT_LIMIT) {
                return {
                    ok: true,
                    value: {
                        kind: 'refused',
                        notice: { tone: 'warning', title: t('common.notice'), message: tFallback(t, 'quickAdd.bulkImportError', 'Could not read that text file.'), durationMs: 4200 },
                    },
                };
            }
            // React Native splits the file as the popup splits pasted lines; submitQuickCaptureLines splits `text` the same way.
            const lines = splitQuickAddBulkLines(input.text);
            if (lines.length === 0) return { ok: true, value: { kind: 'empty' } };
            if (lines.length === 1) return { ok: true, value: { kind: 'setText', text: lines[0] } };
            return { ok: true, value: { kind: 'confirmLines', confirm: getQuickCaptureBulkConfirm(lines, t), lineCount: lines.length, text: input.text } };
        },
    };
}
