/**
 * The native host contract for the Mind Sweep screen (the Inbox's Mind Sweep
 * button), from core's mind-sweep-view-model.ts. Kept in its own file and spread
 * into createNativeHostContract.
 *
 * The screen's state stays with the host while the screen is open, as it stays in
 * React state on mobile:
 *
 * - Send it as `state` ({ scope, step, captured }); the first read sends none.
 *   A scope chip's `value` becomes `state.scope`; Start, Back and Next carry the
 *   `step` to go to. Close and Finish leave the screen, which forgets the state.
 *   The view echoes only the scope and the step: the captures stay with the host,
 *   and the view carries their counts and the requested window.
 * - The capture box's text goes in as `draft` (Add is disabled while it is blank).
 *   After an add that failed, send `addFailed: true` until the next add lands.
 * - Add is addMindSweepItem with the draft and a request UUID. Once it answers,
 *   append its `title` to `state.captured[group.id]`, clear the draft and send
 *   `addFailed: false`.
 *
 * The current cue list's captures come in windows of at most 100 (`offset`,
 * `limit`); a later window sends the first one's `revision`.
 *
 * Add takes a request UUID and retries exactly (native-request-receipts.ts): the
 * new Inbox task takes that UUID as its ID, so a retry, or a replay after a
 * restart, never adds it twice. A replay whose title differs from the task that
 * UUID made is another capture: it is refused (INVALID_INPUT).
 *
 * Only functions read this module's imports from native-host-contract.ts, so the
 * import cycle between the two files is safe.
 */
import { MIND_SWEEP_GROUPS, getMindSweepGroups } from './mind-sweep';
import {
    buildMindSweepView,
    INITIAL_MIND_SWEEP_STATE,
    MIND_SWEEP_INTRO_STEP,
    MIND_SWEEP_SCOPES,
    type MindSweepState,
    type MindSweepView,
} from './mind-sweep-view-model';
import { NATIVE_HOST_CONTRACT_VERSION, NATIVE_HOST_MAX_WINDOW, type NativeHostResult } from './native-host-contract';
import { fail, isObjectRecord, isPaging, isText, page, paramsKey } from './native-host-contract-menu-views';
import { createNativeRequestReceipts, runStoreWrite, settleWrite } from './native-request-receipts';
import { useTaskStore } from './store';

export type NativeMindSweepView = Omit<MindSweepView, 'group'> & {
    version: typeof NATIVE_HOST_CONTRACT_VERSION;
    /** Covers the language, the day and minute, and the state, draft and failure sent. */
    revision: string;
    /** The scope and step as read. The host keeps its captures and sends them back in `state`. */
    state: Pick<MindSweepState, 'scope' | 'step'>;
    group: (Omit<NonNullable<MindSweepView['group']>, 'captured'> & {
        /** `items` is the requested window of this cue list's captures. */
        captured: { label: string; total: number; items: string[] } | null;
    }) | null;
};

type MindSweepDeps = {
    readiness: () => NativeHostResult<null>;
    save: () => Promise<NativeHostResult<null>>;
    t: () => (key: string) => string;
    /** Data plus display revision: the language and the minute. */
    revision: (now: Date) => string;
};

const TITLE_LIMIT = 10_000;
const CAPTURE_LIMIT = 10_000;
const STATE_KEYS = new Set(['scope', 'step', 'captured']);
const GROUP_IDS = new Set(MIND_SWEEP_GROUPS.map((group) => group.id));

/** The host's screen state, completed from the first screen's; null when the screen cannot be in it. */
function readState(value: unknown): MindSweepState | null {
    if (value === undefined) return INITIAL_MIND_SWEEP_STATE;
    if (!isObjectRecord(value) || Object.keys(value).some((key) => !STATE_KEYS.has(key))) return null;
    const scope = value.scope ?? INITIAL_MIND_SWEEP_STATE.scope;
    if (!MIND_SWEEP_SCOPES.includes(scope as MindSweepState['scope'])) return null;
    const step = value.step ?? INITIAL_MIND_SWEEP_STATE.step;
    const groups = getMindSweepGroups(scope as MindSweepState['scope']);
    if (!Number.isSafeInteger(step) || (step as number) < MIND_SWEEP_INTRO_STEP || (step as number) > groups.length) return null;
    const captured = value.captured ?? {};
    if (!isObjectRecord(captured)) return null;
    let count = 0;
    for (const [groupId, items] of Object.entries(captured)) {
        if (!GROUP_IDS.has(groupId) || !Array.isArray(items) || !items.every((item) => isText(item, TITLE_LIMIT) && item.trim().length > 0)) return null;
        count += items.length;
    }
    if (count > CAPTURE_LIMIT) return null;
    return { scope: scope as MindSweepState['scope'], step: step as number, captured: captured as Record<string, string[]> };
}

export function createMindSweepMethods(deps: MindSweepDeps) {
    const receipts = createNativeRequestReceipts({
        save: async () => {
            if (useTaskStore.getState().persistenceFailure) {
                try {
                    await useTaskStore.getState().retryPersistence();
                } catch (error) {
                    return fail('SAVE_FAILED', error instanceof Error ? error.message : String(error));
                }
            }
            return deps.save();
        },
    });

    return {
        /** The Mind Sweep screen for the host's state, draft and last add. */
        getMindSweep(input: {
            state?: Partial<MindSweepState>;
            draft?: string;
            addFailed?: boolean;
            offset?: number;
            limit?: number;
            revision?: string;
        } = {}): NativeHostResult<NativeMindSweepView> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isObjectRecord(input)) return fail('INVALID_INPUT', 'A Mind Sweep read is an object');
            const state = readState(input.state);
            const draft = input.draft ?? '';
            const addFailed = input.addFailed ?? false;
            const window = { offset: input.offset ?? 0, limit: input.limit ?? NATIVE_HOST_MAX_WINDOW, revision: input.revision };
            if (!state || !isText(draft, TITLE_LIMIT) || typeof addFailed !== 'boolean' || !isPaging(window)) {
                return fail('INVALID_INPUT', 'A state the screen can be in, a draft, an add failure flag and a window of at most 100 captures are required');
            }
            const now = new Date();
            const revision = `${deps.revision(now)}:${paramsKey([state, draft, addFailed])}`;
            if (window.revision !== undefined && window.revision !== revision) {
                return fail('STALE_REVISION', 'The screen changed; read it again from offset zero');
            }
            const view = buildMindSweepView({ state, draft, addFailed, t: deps.t() });
            return {
                ok: true,
                value: {
                    ...view,
                    version: NATIVE_HOST_CONTRACT_VERSION,
                    revision,
                    state: { scope: state.scope, step: state.step },
                    group: view.group && {
                        ...view.group,
                        captured: view.group.captured && {
                            label: view.group.captured.label,
                            total: view.group.captured.items.length,
                            items: page(view.group.captured.items, window),
                        },
                    },
                },
            };
        },

        /**
         * Add: the trimmed draft as a new Inbox task, as mobile adds it. Reuse
         * `requestId` to retry; the task takes it as its ID.
         */
        async addMindSweepItem(input: { requestId: string; title: string }): Promise<NativeHostResult<{ id: string; title: string }>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isObjectRecord(input) || !isText(input.title, TITLE_LIMIT) || !input.title.trim()) {
                return fail('INVALID_INPUT', 'A request UUID and a title are required');
            }
            const title = input.title.trim();
            const requestId = input.requestId;
            return receipts.run(requestId, JSON.stringify(['mindSweepAdd', title]), async () => {
                // A replay after a restart: the task this UUID made answers it; another title is another capture.
                const existing = useTaskStore.getState()._tasksById.get(requestId.toLowerCase());
                if (existing) {
                    return existing.title === title
                        ? { ok: true, value: { id: existing.id, title } }
                        : fail('INVALID_INPUT', 'Request ID already belongs to another capture');
                }
                const added = { id: requestId.toLowerCase() };
                const written = await runStoreWrite(async () => {
                    const result = await useTaskStore.getState().addTask(title, { status: 'inbox' }, { captureId: requestId });
                    if (result.success && result.id) added.id = result.id;
                    return result;
                });
                return settleWrite(written, { id: added.id, title });
            });
        },
    };
}
