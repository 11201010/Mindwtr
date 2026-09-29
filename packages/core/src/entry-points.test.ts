import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    isEntityOpenUrl,
    isOpenFeatureUrl,
    isShortcutCaptureUrl,
    normalizeShortcutTags,
    parseEntityOpenUrl,
    parseOpenFeatureUrl,
    parseShortcutCaptureUrl,
    resolveOpenFeaturePath,
} from './capture-deeplink';
import {
    buildCreateNoteCapture,
    buildShareCaptureDraft,
    readAndroidTextShare,
    resolveEntityOpenTarget,
    resolveSystemPath,
} from './entry-points';
import { DEFAULT_GLOBAL_SEARCH_FILTERS } from './global-search-model';
import { loadScreenFixture, openScreenHost, value, type ScreenHost } from './screen-parity.replay';
import { flushPendingSave, resetForTests, useTaskStore } from './store';
import type { Area, Project, Task } from './types';

// Sandbox mode is fixed per runtime (initializeSandboxRuntime); these tests switch what the contract reads.
const sandbox = vi.hoisted(() => ({ on: false }));
vi.mock('./sandbox', async (importOriginal) => ({ ...await importOriginal<typeof import('./sandbox')>(), isSandboxMode: () => sandbox.on }));
const setSandboxMode = (on: boolean) => { sandbox.on = on; };

type RouterCall = ['push' | 'replace', string | { pathname: string; params?: Record<string, string> }];
type Toast = { title: string; message: string; tone: string };
type Delivered = { router: RouterCall[]; toasts: Toast[]; highlights: string[] };
type Fixture = {
    store: { tasks: { id: string; deletedAt?: string }[]; projects: { id: string; deletedAt?: string }[]; areas: { id: string; deletedAt?: string }[] };
    urls: ({ url: string; redirectCold: string; redirectWarm: string; delivered: Delivered } & Record<string, unknown>)[];
    features: { feature: string | null; path: string }[];
    tags: { tags: string[]; normalized: string[] }[];
    shares: {
        share: { text: string | null; title: string | null; subject: string | null };
        read: { text: string | null; webUrl: string | null; subject: string | null; hasShareIntent: boolean };
        delivered: Delivered;
    }[];
};
// Captured from React Native at 4735572f9 (apps/mobile/tests/entry-points.parity.test.tsx; the file's provenance says how).
const fixture = loadScreenFixture<Fixture>('entry-points');
const T0 = '2026-09-01T00:00:00.000Z';
const lookup = {
    _tasksById: new Map(fixture.store.tasks.map((task) => [task.id, task])),
    _projectsById: new Map(fixture.store.projects.map((project) => [project.id, project])),
    _areasById: new Map(fixture.store.areas.map((area) => [area.id, area])),
};

/** React Native's capture screen route params, decoded: the title, the preset props, and the project reference. */
const captureParams = (delivered: Delivered) => {
    const call = delivered.router.find(([, route]) => typeof route === 'object' && route.pathname === '/capture-modal');
    if (!call) return null;
    const params = (call[1] as { params: Record<string, string> }).params;
    const props = params.initialProps ? JSON.parse(decodeURIComponent(params.initialProps)) as { description?: string; tags?: string[] } : {};
    return { title: decodeURIComponent(params.initialValue), props, project: params.project ? decodeURIComponent(params.project) : undefined };
};

describe('entry points: React Native parity', () => {
    it('parses every link as React Native did', () => {
        for (const entry of fixture.urls) {
            const { url } = entry;
            expect({
                url,
                isShortcutCaptureUrl: isShortcutCaptureUrl(url),
                parseShortcutCaptureUrl: parseShortcutCaptureUrl(url),
                isOpenFeatureUrl: isOpenFeatureUrl(url),
                parseOpenFeatureUrl: parseOpenFeatureUrl(url),
                isEntityOpenUrl: isEntityOpenUrl(url),
                parseEntityOpenUrl: parseEntityOpenUrl(url),
            }).toEqual({
                url,
                isShortcutCaptureUrl: entry.isShortcutCaptureUrl,
                parseShortcutCaptureUrl: entry.parseShortcutCaptureUrl,
                isOpenFeatureUrl: entry.isOpenFeatureUrl,
                parseOpenFeatureUrl: entry.parseOpenFeatureUrl,
                isEntityOpenUrl: entry.isEntityOpenUrl,
                parseEntityOpenUrl: entry.parseEntityOpenUrl,
            });
            expect([url, resolveSystemPath(url, true).path, resolveSystemPath(url, false).path]).toEqual([url, entry.redirectCold, entry.redirectWarm]);
        }
        for (const { feature, path } of fixture.features) expect([feature, resolveOpenFeaturePath(feature)]).toEqual([feature, path]);
        for (const { tags, normalized } of fixture.tags) expect(normalizeShortcutTags(tags)).toEqual(normalized);
    });

    it('resolves entity links to the screens React Native opened', () => {
        for (const { url, delivered } of fixture.urls) {
            const entity = parseEntityOpenUrl(url);
            if (!isEntityOpenUrl(url)) continue;
            const target = entity ? resolveEntityOpenTarget(entity.kind, entity.id, lookup) : null;
            const [, route] = delivered.router[0];
            if (!target) expect([url, route]).toEqual([url, '/inbox']);
            else if (target.pathname === '/focus') {
                expect(route).toMatchObject({ pathname: '/focus', params: { taskId: target.taskId, taskTab: 'view' } });
                expect(delivered.highlights).toEqual([target.taskId]);
            } else expect(route).toEqual(target.projectId ? { pathname: '/projects-screen', params: { projectId: target.projectId } } : { pathname: '/projects-screen' });
        }
    });

    it('reads Android text shares and builds their capture as React Native did', () => {
        for (const { share, read, delivered } of fixture.shares) {
            const shared = readAndroidTextShare(share);
            expect([share, shared ? { ...shared, hasShareIntent: true } : null])
                .toEqual([share, read.hasShareIntent ? read : null]);
            if (!shared) continue;
            const draft = buildShareCaptureDraft({ shareSubject: shared.subject, shareText: shared.text, shareWebUrl: shared.webUrl });
            const params = captureParams(delivered);
            expect([share, draft]).toEqual([share, params && { title: params.title, ...params.props }]);
            if (!draft) expect(delivered.toasts).toHaveLength(1);
        }
    });

    it('keeps a link that an email body already holds out of its description', () => {
        // The body carries the link: the description is the body alone, not the body and the link again.
        expect(buildShareCaptureDraft({ shareSubject: 'Subject', shareText: 'Body with https://example.com/doc', shareWebUrl: 'https://example.com/doc' }))
            .toEqual({ title: 'Subject', description: 'Body with https://example.com/doc' });
        // A link the body does not hold still follows it, and a body that is the link is one line.
        expect(buildShareCaptureDraft({ shareSubject: 'Subject', shareText: 'Body', shareWebUrl: 'https://example.com/doc' }))
            .toEqual({ title: 'Subject', description: 'Body\nhttps://example.com/doc' });
        expect(buildShareCaptureDraft({ shareSubject: 'Subject', shareText: 'https://example.com/doc', shareWebUrl: 'https://example.com/doc' }))
            .toEqual({ title: 'Subject', description: 'https://example.com/doc' });
    });

    it('turns an assistant note into the capture link React Native\'s MainActivity builds', () => {
        const link = fixture.urls.find(({ url }) => url.includes('source=create_note'))!;
        expect(buildCreateNoteCapture({ name: ' Voice note ', text: 'Longer spoken text ', extraText: 'ignored' })).toEqual(parseShortcutCaptureUrl(link.url));
        // The name wins; else the text, the Assistant's extra before EXTRA_TEXT; the text is the note only when it differs.
        expect(buildCreateNoteCapture({ name: null, text: null, extraText: '  Call mom  ' })).toEqual({ title: 'Call mom', tags: [] });
        expect(buildCreateNoteCapture({ name: 'Same', text: 'Same', extraText: null })).toEqual({ title: 'Same', tags: [] });
        // An empty extra is still the Assistant's text (Kotlin's ?: falls back only on null), so EXTRA_TEXT is not read.
        expect(buildCreateNoteCapture({ name: '', text: '', extraText: 'Not read' })).toBeNull();
        expect(buildCreateNoteCapture({ name: '  ', text: null, extraText: null })).toBeNull();
    });
});

describe('native host contract: resolveNativeEntryPoint', () => {
    const SCHEME = 'mindwtr-native-dev';
    const tasks: Task[] = fixture.store.tasks.map((task) => ({ id: task.id, title: task.id, status: 'inbox', tags: [], contexts: [], createdAt: T0, updatedAt: T0, ...(task.deletedAt ? { deletedAt: task.deletedAt } : {}) }));
    const project = (id: string, title: string, extra: Partial<Project> = {}): Project => ({ id, title, status: 'active', color: '#3b82f6', order: 0, tagIds: [], createdAt: T0, updatedAt: T0, ...extra });
    const projects: Project[] = [
        ...fixture.store.projects.map((entry) => project(entry.id, entry.id, entry.deletedAt ? { deletedAt: entry.deletedAt } : {})),
        project('p-shop', 'Groceries'),
        project('p-old', 'Old Plans', { status: 'archived' }),
    ];
    const areas: Area[] = fixture.store.areas.map((area, order) => ({ id: area.id, name: area.id, order, createdAt: T0, updatedAt: T0, ...(area.deletedAt ? { deletedAt: area.deletedAt } : {}) }));
    let host: ScreenHost;
    beforeAll(async () => { host = await openScreenHost({ data: { tasks, projects, areas }, record: {}, log: [] }); });
    afterAll(async () => { await flushPendingSave(); resetForTests(); });

    const link = (url: string) => value(host.resolveNativeEntryPoint({ kind: 'link', url: url.replace(/^mindwtr:/i, `${SCHEME}:`), scheme: SCHEME }));
    const fresh = (preset: { note?: string; projectId?: string | null } = {}) => ({
        note: preset.note ?? '', dueDate: null, dueDateHasTime: false, startTime: null, contexts: [],
        projectId: preset.projectId ?? null, areaId: null, priority: null, focus: false, addAnother: false,
    });
    const none = { version: 1, route: null, taskId: null, projectId: null, search: null, capture: null, notice: null };

    it('opens what React Native opened for every link of the fixture', () => {
        for (const { url, redirectCold, delivered } of fixture.urls) {
            // React Native ignores a link of the development build's scheme; here it is the app's own (checked below).
            if (url.startsWith(`${SCHEME}:`)) continue;
            const native = link(url);
            const params = captureParams(delivered);
            const [call] = delivered.router;
            let expected: unknown;
            if (!/^mindwtr:/i.test(url)) expected = none;
            else if (params) {
                // The capture screen's title, note and tags, and the project: an id or title no project carries becomes a token.
                const tags = (params.props.tags ?? []).map((tag) => tag);
                const known = params.project && projects.find((entry) => entry.id === params.project || entry.title.toLowerCase() === params.project!.toLowerCase());
                const text = [params.title, ...tags, params.project && !known ? `+${params.project}` : null].filter(Boolean).join(' ');
                expected = { ...none, route: '/inbox', capture: { text, options: fresh({ note: params.props.description, projectId: known && !known.deletedAt ? known.id : null }), returnToPreviousApp: false } };
            } else if (delivered.toasts.length > 0) expected = { ...none, route: '/inbox', notice: { ...delivered.toasts[0] } };
            else if (call && typeof call[1] === 'object') {
                const route = call[1];
                expected = route.pathname === '/focus'
                    ? { ...none, route: '/focus', taskId: route.params!.taskId }
                    : { ...none, route: '/projects-screen', projectId: route.params?.projectId ?? null };
            } else if (call) {
                const route = call[1] as string;
                expected = route.startsWith('/capture-quick') ? { ...none, route: '/inbox', capture: { text: '', options: fresh(), returnToPreviousApp: false } } : { ...none, route };
            } else if (redirectCold === '/capture-modal?origin=system') {
                expected = { ...none, capture: { text: '', options: fresh(), returnToPreviousApp: true } };
            } else if (redirectCold.startsWith('/settings')) expected = { ...none, route: '/settings' };
            else if (redirectCold === '/inbox') expected = none; // iOS's share handoff
            else {
                // Expo Router's path: host and path, and the global search's query.
                const parsed = new URL(url);
                const route = `/${[parsed.hostname, ...parsed.pathname.split('/')].filter(Boolean).join('/')}`;
                expected = route === '/global-search'
                    ? { ...none, route, search: { query: parsed.searchParams.get('q'), filters: null } }
                    : { ...none, route };
            }
            expect([url, native]).toEqual([url, expected]);
        }
    });

    it('opens every text share React Native opened, in the capture popup', () => {
        for (const { share, delivered } of fixture.shares) {
            const native = value(host.resolveNativeEntryPoint({ kind: 'share', ...share }));
            const params = captureParams(delivered);
            const expected = params
                ? { ...none, capture: { text: params.title, options: fresh({ note: params.props.description }), returnToPreviousApp: false } }
                : delivered.toasts.length > 0 ? { ...none, notice: { ...delivered.toasts[0] } } : none;
            expect([share, native]).toEqual([share, expected]);
        }
    });

    it('matches a capture link\'s project and tags as React Native\'s capture screen saves them', () => {
        const capture = (query: string) => link(`mindwtr://capture?title=Buy%20milk&${query}`).capture!;
        expect(capture('project=groceries')).toMatchObject({ text: 'Buy milk', options: { projectId: 'p-shop' } });
        expect(capture('project=p-shop')).toMatchObject({ text: 'Buy milk', options: { projectId: 'p-shop' } });
        // An archived project takes no task: skipped, as React Native skips it; a name no project carries is created by the token.
        expect(capture('project=old%20plans')).toMatchObject({ text: 'Buy milk', options: { projectId: null } });
        expect(capture('project=New%20%22big%22%20plan')).toMatchObject({ text: 'Buy milk +"New \\"big\\" plan"', options: { projectId: null } });
        expect(capture('tags=errand,two%20words,%23x')).toMatchObject({ text: 'Buy milk #errand #"two words" #x' });
    });

    it('opens the global search with its query and Include completed', () => {
        expect(link('mindwtr:///global-search?q=milk&includeCompleted=TRUE').search).toEqual({ query: 'milk', filters: { ...DEFAULT_GLOBAL_SEARCH_FILTERS, includeCompleted: true } });
        expect(link('mindwtr://global-search').search).toEqual({ query: '', filters: null });
    });

    it('opens an assistant note in the capture popup, and refuses an empty one with the share notice', () => {
        expect(value(host.resolveNativeEntryPoint({ kind: 'createNote', name: 'Voice note', text: 'Longer spoken text', extraText: null })))
            .toEqual({ ...none, route: '/inbox', capture: { text: 'Voice note', options: fresh({ note: 'Longer spoken text' }), returnToPreviousApp: false } });
        expect(value(host.resolveNativeEntryPoint({ kind: 'createNote', name: null, text: null, extraText: '  ' })).notice)
            .toEqual({ tone: 'warning', title: 'Share unavailable', message: 'Mindwtr could not read text or a URL from the shared item.' });
    });

    it('answers an over-long share or note with the share notice, never a bare refusal', () => {
        const notice = { tone: 'warning', title: 'Share unavailable', message: 'Mindwtr could not read text or a URL from the shared item.' };
        expect(value(host.resolveNativeEntryPoint({ kind: 'share', text: 'x'.repeat(500_001), title: null, subject: null }))).toEqual({ ...none, notice });
        expect(value(host.resolveNativeEntryPoint({ kind: 'share', text: 'Body', title: 't'.repeat(100_001), subject: null }))).toEqual({ ...none, notice });
        expect(value(host.resolveNativeEntryPoint({ kind: 'createNote', name: 'n'.repeat(100_001), text: null, extraText: null }))).toEqual({ ...none, notice });
    });

    it('opens nothing for another scheme, and refuses malformed input', () => {
        expect(value(host.resolveNativeEntryPoint({ kind: 'link', url: 'mindwtr://focus', scheme: SCHEME }))).toEqual(none);
        expect(value(host.resolveNativeEntryPoint({ kind: 'link', url: 'MINDWTR-NATIVE-DEV://focus', scheme: SCHEME })).route).toBe('/focus');
        expect(host.resolveNativeEntryPoint({ kind: 'link', url: 'x', scheme: 'Bad Scheme' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(host.resolveNativeEntryPoint({ kind: 'share', text: 1, title: null, subject: null } as never)).toMatchObject({ ok: false });
        expect(host.resolveNativeEntryPoint({ kind: 'other' } as never)).toMatchObject({ ok: false });
    });

    it('in sandbox mode keeps capture, entity and share entries on the Inbox, as React Native\'s disabled root layout does', () => {
        setSandboxMode(true);
        try {
            expect(link('mindwtr://capture?title=Test')).toEqual({ ...none, route: '/inbox' });
            expect(link('mindwtr://open?task=t-live')).toEqual({ ...none, route: '/inbox' });
            expect(link('mindwtr://open-feature?feature=waiting').route).toBe('/waiting');
            expect(value(host.resolveNativeEntryPoint({ kind: 'share', text: 'Shared', title: null, subject: null }))).toEqual(none);
            expect(value(host.resolveNativeEntryPoint({ kind: 'createNote', name: 'Note', text: null, extraText: null }))).toEqual({ ...none, route: '/inbox' });
        } finally {
            setSandboxMode(false);
        }
    });
});

describe('native host contract: planQuickCaptureImport', () => {
    let host: ScreenHost;
    beforeAll(async () => { host = await openScreenHost({ data: {}, record: {}, log: [] }); });
    afterAll(async () => { await flushPendingSave(); resetForTests(); });

    it('asks for several lines, fills one line, ignores an empty file, and refuses an unreadable one', () => {
        const plan = (text: string | null) => value(host.planQuickCaptureImport({ text }));
        expect(plan('Buy milk\r\nCall mom\n')).toEqual({
            kind: 'confirmLines',
            confirm: { title: 'Create 2 tasks?', message: 'Buy milk\nCall mom', confirmLabel: 'Create tasks', cancelLabel: 'Cancel' },
            lineCount: 2,
            text: 'Buy milk\r\nCall mom\n',
        });
        // A blank line joins a paragraph into one line, as React Native's split does (a trailing blank line too).
        expect(plan('  First part\n\n second part ')).toEqual({ kind: 'setText', text: 'First part second part' });
        expect(plan('Buy milk\nCall mom\n\n')).toEqual({ kind: 'setText', text: 'Buy milk Call mom' });
        expect(plan(' \n \n')).toEqual({ kind: 'empty' });
        expect(plan(null)).toEqual({ kind: 'refused', notice: { tone: 'warning', title: 'Notice', message: 'Could not read that text file.', durationMs: 4200 } });
        expect(plan('x'.repeat(100_001))).toMatchObject({ kind: 'refused' });
        expect(host.planQuickCaptureImport({ text: 3 } as never)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('sends the imported lines through the popup\'s Create tasks as React Native creates them', async () => {
        const plan = value(host.planQuickCaptureImport({ text: 'One\nTwo' }));
        if (plan.kind !== 'confirmLines') throw new Error('expected lines');
        const options = value(host.openQuickCapture()).options;
        const snapshot = value(await host.createQuickCaptureSnapshot());
        const ids = ['00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102'];
        expect(value(await host.submitQuickCaptureLines({ text: plan.text, options, captureIds: ids, snapshotFileName: snapshot?.fileName ?? null })))
            .toEqual({ kind: 'saved', taskIds: ids });
        expect(ids.map((id) => useTaskStore.getState()._tasksById.get(id)?.title)).toEqual(['One', 'Two']);
    });

    it('refuses in sandbox mode, as React Native does', () => {
        setSandboxMode(true);
        try {
            expect(value(host.planQuickCaptureImport({ text: 'One' }))).toEqual({
                kind: 'refused', notice: { tone: 'warning', title: 'Notice', message: 'Unavailable in sandbox', durationMs: 4200 },
            });
        } finally {
            setSandboxMode(false);
        }
    });
});
