/**
 * The native host contract for Settings: the menu (settings-menu-model.ts), the
 * General screen (general-settings-model.ts), the Manage screen
 * (manage-settings-model.ts) and the GTD screens (gtd-settings-model.ts). Kept in its own file and spread into
 * createNativeHostContract. Someday sections on Manage use the Someday methods
 * (getSomedaySections, createSomedaySection, renameSomedaySection,
 * reorderSomedaySections, deleteSomedaySection in native-host-contract-menu-views.ts).
 *
 * Where React Native keeps each choice, and how a host keeps it the same way.
 * Synced settings are written by the commands below. Device-local values stay on
 * the device (AsyncStorage on React Native), under these keys:
 *
 * - Theme: `@mindwtr_theme` holds the theme value; `@mindwtr_theme_style` holds
 *   'material3' for the two Material themes, else 'default'. A synced
 *   `settings.theme` wins over the stored one. Send the stored theme as
 *   `deviceTheme` to getGeneralSettings.
 * - Language: `mindwtr-language` holds the language code. After storing it, call
 *   setLanguage({ storedLanguage, systemLocale }) so labels follow.
 * - Android system search (Android 12+ only): `mindwtr:appSearchIndexingEnabled`
 *   is 'true' while on and removed when off. The host also indexes or wipes its
 *   search documents (platform wiring). Send `appSearch` to getGeneralSettings.
 * - App lock: synced (`settings.security.mobileAppLockEnabled`). Before turning
 *   it on, the host asks the device lock with `appLock.enablePrompt`; only a
 *   success sends the edit, a failure shows `appLock.errors[reason]`.
 * - Regional formats open or closed: screen state only, closed on every visit.
 * - Manage's open sections: `mindwtr:settings:manage:openSections`, JSON
 *   `{"areas":false,"people":false,"somedaySections":false,"contexts":false,"tags":false}`.
 *   Send the stored text as `openSections`; each section's `toggle` is the write
 *   that opens or closes it.
 * - The About row's update dot: `mindwtr-update-available` is 'true' when an
 *   update was found. Send it as `updateAvailable` to getSettingsMenu.
 * - GTD › Task editor layout › Open tasks in: `mindwtr:view:taskOpenMode:v1`
 *   holds 'automatic', 'preview' or 'edit' (anything else reads as automatic;
 *   the sandbox keeps its own in memory). Send the stored text as `taskOpenMode`
 *   to getGtdSettings; setGtdSetting's deviceWrites store a new choice.
 * - GTD › Pomodoro's alert notice: the host checks Android's exact-alarm
 *   permission (Android 12+) and shows `pomodoro.controls.alarmNotice` only
 *   while it is denied; its action opens the system's Alarms & reminders page.
 * - GTD › Capture's Android capture intent panel is platform wiring (a native
 *   module and its token); its texts are the `settings.automationCapture*` keys.
 * - GTD screen state, reset on every visit: the text fields' drafts, the open
 *   task editor groups (see `taskEditor.expandedResetKey`), the field sheet, the
 *   default-area picker, and whether the auto-start notice showed.
 *
 * Every write takes a request UUID: while its save is owed a retry only saves
 * (native-request-receipts.ts). Each write is target-state, so a replay after a
 * restart writes nothing: a setting already holding the value, an area already
 * named and colored, a person already added, a token nobody carries any more,
 * an item already deleted.
 *
 * Only functions read this module's imports from native-host-contract.ts, so the
 * import cycle between the two files is safe.
 */
import { AREA_PRESET_COLORS, DEFAULT_AREA_COLOR } from './color-constants';
import { canUseJalaliCalendar, createDateFormatter, getSystemWeekStart, normalizeClockTimeInput, type DateFormattingConfig } from './date';
import {
    buildGeneralSettingsModel,
    buildGeneralSettingsUpdate,
    getGeneralSettingsDeviceWrites,
    isGeneralSettingStored,
    MOBILE_QUICK_ACCESS_VIEW_OPTIONS,
    resolveGeneralThemeMode,
    SETTINGS_LANGUAGE_OPTIONS,
    type GeneralSettingsEdit,
    type GeneralSettingsModel,
    type SettingsDeviceWrite,
} from './general-settings-model';
import { FOCUS_TASK_LIMIT_OPTIONS } from './focus-utils';
import {
    buildGtdSettingsModel,
    buildGtdSettingsUpdate,
    getGtdSettingsDeviceWrites,
    GTD_AUTO_ARCHIVE_DAY_OPTIONS,
    GTD_DEFAULT_AREA_ACTIVE_OPTION,
    GTD_TASK_OPEN_MODES,
    isGtdSettingStored,
    readGtdTaskOpenMode,
    type GtdSettingsEdit,
    type GtdSettingsModel,
} from './gtd-settings-model';
import { formatLocalDate } from './import-source-reader';
import { tFallback } from './i18n';
import type { Language } from './i18n/i18n-types';
import {
    buildManagePersonRow,
    getManageDeleteConfirm,
    getManageEditorDraft,
    getManageEditorText,
    getManageSettingsText,
    isManageAreaNameTaken,
    MANAGE_OPEN_SECTIONS_STORAGE_KEY,
    MANAGE_SECTION_ORDER,
    parseManageOpenSections,
    planManageEditorSave,
    sortManageAreas,
    sortManagePeople,
    type ManageConfirm,
    type ManageEditorDraft,
    type ManageEditorTarget,
    type ManageEditorWrite,
    type ManageSectionKey,
    type ManageUntranslatedText,
} from './manage-settings-model';
import { NATIVE_HOST_CONTRACT_VERSION, type NativeHostResult } from './native-host-contract';
import { fail, firstWindow, isObjectRecord, isPaging, isText, page, type NativeWindow } from './native-host-contract-menu-views';
import { createNativeRequestReceipts, runStoreWrite, settleWrite } from './native-request-receipts';
import { getPersonTaskCounts } from './people';
import { SETTINGS_THEME_VALUE_SET } from './settings-options';
import {
    buildSettingsAdvancedMenu,
    buildSettingsMenu,
    getSettingsSyncBadge,
    type SettingsMenuRow,
    type SettingsSyncBadgeState,
} from './settings-menu-model';
import { useTaskStore } from './store';
import { normalizeTagId } from './store-helpers';
import { formatTagIdPreservingCase } from './store-projects/shared';
import { DEFAULT_TASK_EDITOR_ORDER, isTaskEditorSectionableField, TASK_EDITOR_SECTION_ORDER } from './task-editor-layout';
import type { TaskEditorFieldId } from './types';
import { sortViewSectionDefinitions } from './view-sections';

type Translate = (key: string) => string;

export type SettingsDeps = {
    readiness: () => NativeHostResult<null>;
    save: () => Promise<NativeHostResult<null>>;
    t: () => Translate;
    language: () => Language;
    systemLocale: () => string | null;
    /** The user's date formatting (createDateFormatter). */
    dateFormatting: () => DateFormattingConfig;
    /** Tasks, projects, areas, people and settings generations. */
    dataRevision: () => string;
    requestIdPattern: RegExp;
};

/** Settings screens the native host draws so far; draw the other rows disabled. */
export const NATIVE_SETTINGS_SCREENS: readonly string[] = ['general', 'gtd', 'manage'];

type NativeMenuRow<Id extends string = string> = SettingsMenuRow<Id> & { enabled: boolean };

export type NativeSettingsMenu = {
    version: typeof NATIVE_HOST_CONTRACT_VERSION;
    revision: string;
    title: string;
    searchPlaceholder: string;
    /** The cards left after the search; each row opens the screen of its id. */
    groups: NativeMenuRow[][];
    noMatches: string | null;
    /** The Advanced screen (the `advanced` row opens it). */
    advanced: { title: string; rows: NativeMenuRow[] };
};

export type NativeGeneralSettings = GeneralSettingsModel & { version: typeof NATIVE_HOST_CONTRACT_VERSION; revision: string };

export type NativeGtdSettings = GtdSettingsModel & { version: typeof NATIVE_HOST_CONTRACT_VERSION; revision: string };

/** A write's answer: whether the store changed, and what the host stores on the device. */
export type NativeSettingsWriteResult = { changed: boolean; deviceWrites: SettingsDeviceWrite[] };

/** What the editor edits, as a host sends it back; the contract reads the current values. */
export type NativeManageEditorTarget =
    | { type: 'area'; id: string }
    | { type: 'newArea' }
    | { type: 'unassignedArea' }
    | { type: 'newPerson' }
    | { type: 'person'; id: string }
    | { type: 'context' | 'tag'; name: string };

export type NativeManageDeleteTarget = { type: 'area' | 'person'; id: string } | { type: 'context' | 'tag'; name: string };

/** Opens the editor: send `target` to saveManageEditor with the fields, which start at `draft`. */
type NativeManageEdit = { target: NativeManageEditorTarget; draft: ManageEditorDraft };

export type NativeManageAreaRow = { id: string; name: string; color: string; edit: NativeManageEdit; delete: NativeManageDeleteTarget; deleteConfirm: ManageConfirm };
export type NativeManagePersonRow = ReturnType<typeof buildManagePersonRow> & {
    id: string;
    name: string;
    edit: NativeManageEdit;
    delete: NativeManageDeleteTarget;
    deleteConfirm: ManageConfirm;
};
export type NativeManageValueRow = { value: string; edit: NativeManageEdit; delete: NativeManageDeleteTarget; deleteConfirm: ManageConfirm };
export type ManageListName = 'areas' | 'people' | 'contexts' | 'tags';

export type NativeManageSettings = {
    version: typeof NATIVE_HOST_CONTRACT_VERSION;
    /** Changes with the data, settings and language; getManageSettingsList pages under it. */
    revision: string;
    title: string;
    /** In screen order. A section's rows show while it is open. */
    sections: { key: ManageSectionKey; title: string; count: number; open: boolean; toggle: SettingsDeviceWrite }[];
    /**
     * When the screen opens with a stored value, React Native writes it back
     * normalized (all five keys, booleans); null when nothing is stored.
     */
    openSectionsRestore: SettingsDeviceWrite | null;
    areas: {
        unassigned: { label: string; description: string; color: string; edit: NativeManageEdit };
        rows: NativeWindow<NativeManageAreaRow>;
        /** Shown above the new-area row when there is no area. */
        empty: string | null;
        newArea: { label: string; hint: string; addLabel: string; color: string; edit: NativeManageEdit };
    };
    /** getSomedaySections lists the rows; the hint shows when there is none. */
    somedaySections: { emptyHint: string | null };
    people: {
        rows: NativeWindow<NativeManagePersonRow>;
        empty: string | null;
        newPerson: { label: string; hint: string; addLabel: string; edit: NativeManageEdit };
        text: { openReference: string; openReferenceFailed: string; editLabel: string; deleteLabel: string; countHint: string };
    };
    contexts: { rows: NativeWindow<NativeManageValueRow>; empty: string | null };
    tags: { rows: NativeWindow<NativeManageValueRow>; empty: string | null };
    /** The editor dialog's texts by target type, and the color swatches it offers. */
    editor: {
        text: Record<ManageEditorTarget['type'], ReturnType<typeof getManageEditorText>>;
        colors: { color: string; label: string }[];
    };
};

const EDITOR_TYPES: ManageEditorTarget['type'][] = ['area', 'newArea', 'unassignedArea', 'newPerson', 'person', 'context', 'tag'];
const WEEK_STARTS = new Set(['system', 'sunday', 'monday', 'saturday']);
const DATE_FORMATS = new Set(['system', 'dmy', 'mdy', 'ymd']);
const TIME_FORMATS = new Set(['system', '12h', '24h']);
const CALENDAR_SYSTEMS = new Set(['gregorian', 'jalali']);
const LANGUAGES = new Set<string>(SETTINGS_LANGUAGE_OPTIONS.map((lang) => lang.id));
const SYNC_BADGES = new Set<string>(['hidden', 'syncing', 'healthy', 'attention']);

/** A General edit as a host sends it back; null when it is not one the screen offers. */
function readGeneralEdit(value: unknown, calendarSystemShown: boolean): GeneralSettingsEdit | null {
    if (!isObjectRecord(value) || Object.keys(value).some((key) => key !== 'type' && key !== 'value')) return null;
    const v = value.value;
    const ok = (() => {
        switch (value.type) {
            case 'theme': return SETTINGS_THEME_VALUE_SET.has(v as never);
            case 'quickAccessView': return MOBILE_QUICK_ACCESS_VIEW_OPTIONS.includes(v as never);
            case 'language': return LANGUAGES.has(v as string);
            case 'weekStart': return WEEK_STARTS.has(v as string);
            case 'dateFormat': return DATE_FORMATS.has(v as string);
            case 'timeFormat': return TIME_FORMATS.has(v as string);
            // Offered only for a Persian language or device locale.
            case 'calendarSystem': return calendarSystemShown && CALENDAR_SYSTEMS.has(v as string);
            case 'showTaskAge':
            case 'appLock':
            case 'appSearch':
                return typeof v === 'boolean';
            default: return false;
        }
    })();
    return ok ? value as GeneralSettingsEdit : null;
}

const GTD_BOOLEAN_EDITS = new Set<string>([
    'pomodoro', 'pomodoroLinkTask', 'pomodoroAutoStartBreaks', 'pomodoroAutoStartFocus', 'pomodoroCompletionAlert',
    'saveAudioAttachments', 'quickAddAutoClean', 'naturalLanguageDates', 'markdownEditorAssist',
    'dailyReviewFocusStep', 'weeklyReviewContextStep',
    'inboxTwoMinute', 'inboxProjectFirst', 'inboxContextStep', 'inboxSchedule',
]);
const OPENABLE_SECTIONS = new Set<string>(['scheduling', 'organization', 'details']);
const isTaskEditorField = (value: unknown): value is TaskEditorFieldId => DEFAULT_TASK_EDITOR_ORDER.includes(value as TaskEditorFieldId);

/**
 * A GTD edit as a host sends it back; null when it is not one the screens offer.
 * A schedule time comes back normalized; one that is not blank or a time is refused.
 */
function readGtdEdit(value: unknown, liveAreaIds: Set<string>): GtdSettingsEdit | null {
    if (!isObjectRecord(value)) return null;
    const { type, value: v } = value;
    const only = (...keys: string[]) => Object.keys(value).every((key) => key === 'type' || keys.includes(key));
    if (type === 'defaultScheduleTime') {
        const normalized = only('value') && isText(v, 50) ? normalizeClockTimeInput(v) : null;
        return normalized === null ? null : { type, value: normalized };
    }
    const ok = (() => {
        if (GTD_BOOLEAN_EDITS.has(type as string)) return only('value') && typeof v === 'boolean';
        switch (type) {
            case 'focusTaskLimit': return only('value') && FOCUS_TASK_LIMIT_OPTIONS.includes(v as never);
            case 'defaultProjectFlowMode': return only('value') && (v === 'parallel' || v === 'sequential');
            case 'autoArchiveDays': return only('value') && GTD_AUTO_ARCHIVE_DAY_OPTIONS.includes(v as number);
            case 'pomodoroDurations': return only('focusMinutes', 'breakMinutes') && isText(value.focusMinutes, 20) && isText(value.breakMinutes, 20);
            case 'captureMethod': return only('value') && (v === 'text' || v === 'audio');
            case 'defaultArea': return only('value') && (v === '' || v === GTD_DEFAULT_AREA_ACTIVE_OPTION || liveAreaIds.has(v as string));
            case 'taskOpenMode': return only('value') && GTD_TASK_OPEN_MODES.includes(v as never);
            case 'taskEditorPreset': return only('value') && (v === 'simple' || v === 'standard' || v === 'full');
            case 'taskEditorFieldVisible': return only('field', 'value') && isTaskEditorField(value.field) && typeof v === 'boolean';
            // Any order of every field (a move offers one).
            case 'taskEditorOrder':
                return only('value') && Array.isArray(v) && v.length === DEFAULT_TASK_EDITOR_ORDER.length
                    && new Set(v).size === v.length && v.every(isTaskEditorField);
            case 'taskEditorFieldSection':
                return only('field', 'value') && isTaskEditorField(value.field) && isTaskEditorSectionableField(value.field)
                    && TASK_EDITOR_SECTION_ORDER.includes(v as never);
            case 'taskEditorSectionOpen': return only('section', 'value') && OPENABLE_SECTIONS.has(value.section as string) && typeof v === 'boolean';
            case 'taskEditorReset': return only();
            default: return false;
        }
    })();
    return ok ? value as GtdSettingsEdit : null;
}

const isName = (value: unknown): value is string => isText(value, 500) && value.trim().length > 0;

export function createSettingsMethods(deps: SettingsDeps) {
    const durableSave = async (): Promise<NativeHostResult<null>> => {
        try {
            if (useTaskStore.getState().persistenceFailure) await useTaskStore.getState().retryPersistence();
        } catch (error) {
            return fail('SAVE_FAILED', error instanceof Error ? error.message : String(error));
        }
        return deps.save();
    };
    const receipts = createNativeRequestReceipts({ save: durableSave });

    const manageRevision = () => `${deps.dataRevision()}:${deps.language()}`;

    const systemLocale = () => deps.systemLocale() ?? '';

    const generalModel = (input: { deviceTheme?: string | null; appSearch?: { supported: boolean; enabled: boolean } }) => {
        const state = useTaskStore.getState();
        const locale = systemLocale();
        // The System date format's sample: today in the short date the app shows under System.
        const sample = createDateFormatter({ ...deps.dateFormatting(), dateFormat: 'system' })(new Date(), 'P');
        return buildGeneralSettingsModel({
            settings: state.settings,
            themeMode: resolveGeneralThemeMode(state.settings.theme, input.deviceTheme),
            language: deps.language(),
            systemLocale: locale,
            systemWeekStart: getSystemWeekStart(locale),
            systemDateSample: sample,
            appSearch: input.appSearch ?? { supported: false, enabled: false },
            t: deps.t(),
        });
    };

    // Carriers of a context or tag, as the store's rename and delete match them.
    const contextCarried = (name: string, except?: string) => {
        const key = name.trim().toLowerCase();
        return useTaskStore.getState()._allTasks.some((task) => (task.contexts ?? []).some((ctx) => ctx.trim().toLowerCase() === key && ctx !== except));
    };
    const tagCarried = (name: string, except?: string) => {
        const key = normalizeTagId(name);
        const { _allTasks, _allProjects } = useTaskStore.getState();
        const match = (tag: string) => normalizeTagId(tag) === key && tag !== except;
        return _allTasks.some((task) => (task.tags ?? []).some(match)) || _allProjects.some((project) => (project.tagIds ?? []).some(match));
    };

    const storeData = () => {
        const state = useTaskStore.getState();
        return [state._allTasks, state._allProjects, state._allAreas, state._allPeople, state.settings];
    };

    /** Drops writes the store would make again for a target it already holds, so a replay writes nothing. */
    const pendingWrites = (writes: ManageEditorWrite[]): ManageEditorWrite[] => {
        const state = useTaskStore.getState();
        return writes.filter((write) => {
            switch (write.kind) {
                // The editor's only settings write: the unassigned color.
                case 'updateSettings':
                    return state.settings.appearance?.unassignedAreaColor !== write.updates.appearance?.unassignedAreaColor;
                // A live area has the name: the store returns it and writes nothing
                // (the editor's Save is off for it: isManageEditorSaveDisabled).
                case 'addArea':
                    return !isManageAreaNameTaken('newArea', write.name, state.areas);
                case 'renameContext':
                    return contextCarried(write.from, write.to.trim());
                case 'renameTag':
                    return tagCarried(write.from, formatTagIdPreservingCase(write.to));
                default:
                    return true;
            }
        });
    };

    const runEditorWrite = async (write: ManageEditorWrite) => {
        const state = useTaskStore.getState();
        switch (write.kind) {
            case 'updateSettings':
                return state.updateSettings(write.updates);
            case 'addArea':
                return (await state.addArea(write.name, write.props)) ? undefined : { success: false, error: 'Area creation failed' };
            case 'addPerson':
                return (await state.addPerson(write.name, write.props)) ? undefined : { success: false, error: 'Person creation failed' };
            case 'updatePerson':
                return state.updatePerson(write.id, write.updates);
            case 'renamePerson':
                return state.renamePerson(write.id, write.name, write.options);
            case 'updateArea':
                return state.updateArea(write.id, write.updates);
            case 'renameContext':
                return state.renameContext(write.from, write.to);
            case 'renameTag':
                return state.renameTag(write.from, write.to);
        }
    };

    /** The editor target with the values it holds now; null when it no longer exists. */
    const resolveTarget = (target: NativeManageEditorTarget): ManageEditorTarget | null => {
        const state = useTaskStore.getState();
        switch (target.type) {
            case 'area': {
                const area = state.areas.find((entry) => entry.id === target.id);
                return area ? { type: 'area', id: area.id, name: area.name, color: area.color } : null;
            }
            case 'person': {
                const person = state.people.find((entry) => entry.id === target.id);
                return person ? { type: 'person', id: person.id, name: person.name, note: person.note, referenceLink: person.referenceLink } : null;
            }
            case 'unassignedArea':
                return { type: 'unassignedArea', color: state.settings.appearance?.unassignedAreaColor || DEFAULT_AREA_COLOR };
            default:
                return target;
        }
    };

    const readEditorTarget = (value: unknown): NativeManageEditorTarget | null => {
        if (!isObjectRecord(value)) return null;
        switch (value.type) {
            case 'newArea':
            case 'newPerson':
            case 'unassignedArea':
                return Object.keys(value).length === 1 ? { type: value.type } : null;
            case 'area':
            case 'person':
                return Object.keys(value).length === 2 && isName(value.id) ? { type: value.type, id: value.id } : null;
            case 'context':
            case 'tag':
                return Object.keys(value).length === 2 && isName(value.name) ? { type: value.type, name: value.name } : null;
            default:
                return null;
        }
    };

    const buildManage = (openSectionsRaw: string | null) => {
        const state = useTaskStore.getState();
        const t = deps.t();
        const tf = (key: string, fallback: string) => tFallback(t, key, fallback);
        // Keys not in en.ts yet; mobile resolves the same fallbacks (manage-settings-screen.tsx).
        const untranslated: ManageUntranslatedText = {
            newAreaHint: tf('areas.newHint', 'Create an area for related projects and tasks.'),
            peopleEmpty: tf('people.empty', 'No people yet'),
            newPersonHint: tf('people.newHint', 'Add someone you delegate or wait on.'),
            editPerson: tf('people.edit', 'Edit person'),
            personNamePlaceholder: tf('people.namePlaceholder', 'Person name'),
            notePlaceholder: tf('people.notePlaceholder', 'Note'),
            referencePlaceholder: tf('people.referencePlaceholder', 'Reference link, including obsidian://'),
            openReference: tf('people.openReference', 'Open reference link'),
            openReferenceFailed: tf('people.openReferenceFailed', 'Could not open this reference link.'),
        };
        const text = getManageSettingsText(t, untranslated);
        const open = parseManageOpenSections(openSectionsRaw);
        const areas = sortManageAreas(state.areas);
        const people = sortManagePeople(state.people);
        const counts = getPersonTaskCounts(state._allTasks);
        const { allContexts, allTags } = state.getDerivedState();
        const somedayCount = sortViewSectionDefinitions(state.settings.gtd?.viewSections?.someday).length;
        const unassignedColor = state.settings.appearance?.unassignedAreaColor || DEFAULT_AREA_COLOR;
        const areaRows: NativeManageAreaRow[] = areas.map((area) => ({
            id: area.id,
            name: area.name,
            color: area.color || DEFAULT_AREA_COLOR,
            edit: { target: { type: 'area', id: area.id }, draft: getManageEditorDraft({ type: 'area', id: area.id, name: area.name, color: area.color }) },
            delete: { type: 'area', id: area.id },
            deleteConfirm: getManageDeleteConfirm(t, area.name, 'areas.deleteConfirm'),
        }));
        const personRows: NativeManagePersonRow[] = people.map((person) => ({
            id: person.id,
            name: person.name,
            ...buildManagePersonRow(person, counts, t),
            edit: {
                target: { type: 'person', id: person.id },
                draft: getManageEditorDraft({ type: 'person', id: person.id, name: person.name, note: person.note, referenceLink: person.referenceLink }),
            },
            delete: { type: 'person', id: person.id },
            deleteConfirm: getManageDeleteConfirm(t, person.name, 'people.deleteConfirm'),
        }));
        const valueRows = (type: 'context' | 'tag', values: readonly string[]): NativeManageValueRow[] => values.map((value) => ({
            value,
            edit: { target: { type, name: value }, draft: getManageEditorDraft({ type, name: value }) },
            delete: { type, name: value },
            deleteConfirm: getManageDeleteConfirm(t, value),
        }));
        const counted: Record<ManageSectionKey, number> = {
            areas: areas.length, somedaySections: somedayCount, people: people.length, contexts: allContexts.length, tags: allTags.length,
        };
        const contextRows = valueRows('context', allContexts);
        const tagRows = valueRows('tag', allTags);
        const lists: Record<ManageListName, readonly (NativeManageAreaRow | NativeManagePersonRow | NativeManageValueRow)[]> = {
            areas: areaRows, people: personRows, contexts: contextRows, tags: tagRows,
        };
        const changeColor = t('projects.changeColor');
        const view: Omit<NativeManageSettings, 'version' | 'revision'> = {
            title: text.title,
            sections: MANAGE_SECTION_ORDER.map((key) => ({
                key,
                title: text.sections[key],
                count: counted[key],
                open: open[key],
                toggle: { key: MANAGE_OPEN_SECTIONS_STORAGE_KEY, value: JSON.stringify({ ...open, [key]: !open[key] }) },
            })),
            openSectionsRestore: openSectionsRaw ? { key: MANAGE_OPEN_SECTIONS_STORAGE_KEY, value: JSON.stringify(open) } : null,
            areas: {
                unassigned: {
                    label: text.areas.unassignedLabel,
                    description: text.areas.unassignedDescription,
                    color: unassignedColor,
                    edit: { target: { type: 'unassignedArea' }, draft: getManageEditorDraft({ type: 'unassignedArea', color: unassignedColor }) },
                },
                rows: firstWindow(areaRows),
                empty: areas.length === 0 ? text.areas.empty : null,
                newArea: {
                    label: text.areas.newLabel,
                    hint: text.areas.newHint,
                    addLabel: text.areas.addLabel,
                    color: DEFAULT_AREA_COLOR,
                    edit: { target: { type: 'newArea' }, draft: getManageEditorDraft({ type: 'newArea' }) },
                },
            },
            somedaySections: { emptyHint: somedayCount === 0 ? text.somedaySections.emptyHint : null },
            people: {
                rows: firstWindow(personRows),
                empty: people.length === 0 ? text.people.empty : null,
                newPerson: {
                    label: text.people.newLabel,
                    hint: text.people.newHint,
                    addLabel: text.people.addLabel,
                    edit: { target: { type: 'newPerson' }, draft: getManageEditorDraft({ type: 'newPerson' }) },
                },
                text: (({ openReference, openReferenceFailed, editLabel, deleteLabel, countHint }) => (
                    { openReference, openReferenceFailed, editLabel, deleteLabel, countHint }
                ))(text.people),
            },
            contexts: { rows: firstWindow(contextRows), empty: allContexts.length === 0 ? text.contexts.empty : null },
            tags: { rows: firstWindow(tagRows), empty: allTags.length === 0 ? text.tags.empty : null },
            editor: {
                text: Object.fromEntries(EDITOR_TYPES.map((type) => [type, getManageEditorText(t, type, untranslated)])) as NativeManageSettings['editor']['text'],
                colors: AREA_PRESET_COLORS.map((color) => ({ color, label: `${changeColor}: ${color}` })),
            },
        };
        return { view, lists };
    };

    const readOpenSections = (value: unknown): string | null | undefined => (
        value === undefined || value === null ? null : isText(value, 2000) ? value : undefined
    );

    const menuRow = <Id extends string>(row: SettingsMenuRow<Id>): NativeMenuRow<Id> => ({ ...row, enabled: NATIVE_SETTINGS_SCREENS.includes(row.id) });

    return {
        /**
         * The Settings menu for the search text. `syncBadge` is the sync row's badge
         * as the host's sync status resolves it; `updateAvailable` is the stored
         * `mindwtr-update-available` flag.
         */
        getSettingsMenu(input: { query?: string; syncBadge?: SettingsSyncBadgeState; updateAvailable?: boolean } = {}): NativeHostResult<NativeSettingsMenu> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isObjectRecord(input) || (input.query !== undefined && !isText(input.query, 500))
                || (input.syncBadge !== undefined && !SYNC_BADGES.has(input.syncBadge as string))
                || (input.updateAvailable !== undefined && typeof input.updateAvailable !== 'boolean')) {
                return fail('INVALID_INPUT', 'A search text, a sync badge state and an update flag are optional; nothing else is accepted');
            }
            const t = deps.t();
            const badge = getSettingsSyncBadge(input.syncBadge ?? 'hidden', t);
            const menu = buildSettingsMenu({
                t,
                query: input.query ?? '',
                sync: badge ? { color: badge.color, accessibilityLabel: badge.accessibilityLabel } : undefined,
                updateAvailable: input.updateAvailable === true,
            });
            const advanced = buildSettingsAdvancedMenu(t);
            return {
                ok: true,
                value: {
                    version: NATIVE_HOST_CONTRACT_VERSION,
                    revision: manageRevision(),
                    title: menu.title,
                    searchPlaceholder: menu.searchPlaceholder,
                    groups: menu.groups.map((group) => group.map(menuRow)),
                    noMatches: menu.noMatches,
                    advanced: { title: advanced.title, rows: advanced.rows.map(menuRow) },
                },
            };
        },

        /**
         * Settings › General. `deviceTheme` is the stored `@mindwtr_theme`;
         * `appSearch` says whether Android system search indexing is supported and on.
         * Each option's `edit` goes to setGeneralSetting.
         */
        getGeneralSettings(input: { deviceTheme?: string | null; appSearch?: { supported: boolean; enabled: boolean } } = {}): NativeHostResult<NativeGeneralSettings> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isObjectRecord(input)
                || (input.deviceTheme !== undefined && input.deviceTheme !== null && !isText(input.deviceTheme, 100))
                || (input.appSearch !== undefined && (!isObjectRecord(input.appSearch)
                    || typeof input.appSearch.supported !== 'boolean' || typeof input.appSearch.enabled !== 'boolean'))) {
                return fail('INVALID_INPUT', 'deviceTheme must be text or null, and appSearch { supported, enabled } booleans');
            }
            return {
                ok: true,
                value: {
                    version: NATIVE_HOST_CONTRACT_VERSION,
                    revision: `${manageRevision()}:${systemLocale()}:${formatLocalDate(new Date())}`,
                    ...generalModel(input),
                },
            };
        },

        /**
         * One General control's `edit`: writes only the setting it changes, and returns
         * the device-local writes the host stores (`deviceWrites`). A setting that
         * already holds the value is not written again.
         */
        async setGeneralSetting(input: { requestId: string; edit: GeneralSettingsEdit }): Promise<NativeHostResult<NativeSettingsWriteResult>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const calendarSystemShown = canUseJalaliCalendar({ language: deps.language(), systemLocale: systemLocale() });
            const edit = isObjectRecord(input) ? readGeneralEdit(input.edit, calendarSystemShown) : null;
            if (!edit || typeof input.requestId !== 'string' || !deps.requestIdPattern.test(input.requestId)) {
                return fail('INVALID_INPUT', 'A request UUID and an edit the General screen offers are required');
            }
            return receipts.run<NativeSettingsWriteResult>(input.requestId, JSON.stringify(['general', edit]), async () => {
                const deviceWrites = getGeneralSettingsDeviceWrites(edit);
                const settings = useTaskStore.getState().settings;
                const update = buildGeneralSettingsUpdate(settings, edit);
                if (!update || isGeneralSettingStored(settings, edit)) return { ok: true, value: { changed: false, deviceWrites } };
                const written = await runStoreWrite(() => useTaskStore.getState().updateSettings(update));
                return settleWrite(written, { changed: true, deviceWrites });
            });
        },

        /**
         * Settings › GTD: the hub and its six sub-screens in one view (draw the one
         * the host is on; a link's `screen` opens a sub-screen). `taskOpenMode` is
         * the stored `mindwtr:view:taskOpenMode:v1` text. Each control's `edit`
         * goes to setGtdSetting.
         */
        getGtdSettings(input: { taskOpenMode?: string | null } = {}): NativeHostResult<NativeGtdSettings> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isObjectRecord(input) || (input.taskOpenMode !== undefined && input.taskOpenMode !== null && !isText(input.taskOpenMode, 100))) {
                return fail('INVALID_INPUT', 'taskOpenMode must be the stored text or null');
            }
            const state = useTaskStore.getState();
            const model = buildGtdSettingsModel({
                settings: state.settings,
                areas: state.areas,
                taskOpenMode: readGtdTaskOpenMode(input.taskOpenMode),
                t: deps.t(),
            });
            return { ok: true, value: { version: NATIVE_HOST_CONTRACT_VERSION, revision: manageRevision(), ...model } };
        },

        /**
         * One GTD control's `edit`: writes only the setting it changes, and returns
         * the device-local writes the host stores (`deviceWrites`). A setting that
         * already holds the value is not written again. The two text fields commit
         * on blur, sending the typed text: a schedule time that is not blank or a
         * time answers INVALID_INPUT (show `hub.defaultScheduleTime.invalidMessage`),
         * and after a commit each field shows the view's value again.
         */
        async setGtdSetting(input: { requestId: string; edit: GtdSettingsEdit }): Promise<NativeHostResult<NativeSettingsWriteResult>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const liveAreaIds = new Set(useTaskStore.getState().areas.filter((area) => !area.deletedAt).map((area) => area.id));
            const edit = isObjectRecord(input) ? readGtdEdit(input.edit, liveAreaIds) : null;
            if (!edit || typeof input.requestId !== 'string' || !deps.requestIdPattern.test(input.requestId)) {
                return fail('INVALID_INPUT', 'A request UUID and an edit the GTD screens offer are required');
            }
            return receipts.run<NativeSettingsWriteResult>(input.requestId, JSON.stringify(['gtd', edit]), async () => {
                const deviceWrites = getGtdSettingsDeviceWrites(edit);
                const settings = useTaskStore.getState().settings;
                const update = buildGtdSettingsUpdate(settings, edit);
                if (!update || isGtdSettingStored(settings, edit)) return { ok: true, value: { changed: false, deviceWrites } };
                const written = await runStoreWrite(() => useTaskStore.getState().updateSettings(update));
                return settleWrite(written, { changed: true, deviceWrites });
            });
        },

        /**
         * Settings › Manage. `openSections` is the stored
         * `mindwtr:settings:manage:openSections` text (null when unset). Lists show
         * their first window; getManageSettingsList pages the rest.
         */
        getManageSettings(input: { openSections?: string | null } = {}): NativeHostResult<NativeManageSettings> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const openSections = isObjectRecord(input) ? readOpenSections(input.openSections) : undefined;
            if (openSections === undefined) return fail('INVALID_INPUT', 'openSections must be the stored text or null');
            const { view } = buildManage(openSections);
            return { ok: true, value: { version: NATIVE_HOST_CONTRACT_VERSION, revision: manageRevision(), ...view } };
        },

        /** A later window of Manage's areas, people, contexts or tags under the Manage revision. */
        getManageSettingsList(input: { list: ManageListName; offset: number; limit: number; revision: string }): NativeHostResult<{
            version: typeof NATIVE_HOST_CONTRACT_VERSION;
            revision: string;
            list: ManageListName;
            total: number;
            items: (NativeManageAreaRow | NativeManagePersonRow | NativeManageValueRow)[];
        }> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isObjectRecord(input) || !['areas', 'people', 'contexts', 'tags'].includes(input.list as string)
                || typeof input.revision !== 'string' || !isPaging(input)) {
                return fail('INVALID_INPUT', 'A list, a valid window and the Manage revision are required');
            }
            const revision = manageRevision();
            if (input.revision !== revision) return fail('STALE_REVISION', 'Manage changed; read it again');
            const items = buildManage(null).lists[input.list as ManageListName];
            return {
                ok: true,
                value: { version: NATIVE_HOST_CONTRACT_VERSION, revision, list: input.list as ManageListName, total: items.length, items: page(items, input) },
            };
        },

        /**
         * The editor's Save for a `target` (a row's `edit.target`) with the dialog's
         * fields. Writes what changed against the values stored now: a new area or
         * person, a rename, a color, a note or link, the unassigned color. A blank
         * name is refused; nothing to change answers `changed: false`. A new area
         * named like a live area writes nothing: the editor keeps Save off for it
         * and shows `editor.text.newArea.nameTaken` (isManageEditorSaveDisabled with
         * the area rows' names).
         */
        async saveManageEditor(input: {
            requestId: string;
            target: NativeManageEditorTarget;
            name?: string;
            color?: string;
            note?: string;
            referenceLink?: string;
        }): Promise<NativeHostResult<{ changed: boolean }>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const target = isObjectRecord(input) ? readEditorTarget(input.target) : null;
            if (!target || typeof input.requestId !== 'string' || !deps.requestIdPattern.test(input.requestId)
                || (input.name !== undefined && !isText(input.name, 500))
                || (input.color !== undefined && !isText(input.color, 50))
                || (input.note !== undefined && !isText(input.note, 10_000))
                || (input.referenceLink !== undefined && !isText(input.referenceLink, 2000))) {
                return fail('INVALID_INPUT', 'A request UUID, an editor target and text fields are required');
            }
            const fields = { name: input.name ?? '', color: input.color ?? null, note: input.note ?? '', referenceLink: input.referenceLink ?? '' };
            return receipts.run<{ changed: boolean }>(input.requestId, JSON.stringify(['manageEditor', target, fields]), async () => {
                const resolved = resolveTarget(target);
                if (!resolved) return fail('INVALID_INPUT', 'That item is not available');
                const draft = { ...getManageEditorDraft(resolved), name: fields.name, note: fields.note, referenceLink: fields.referenceLink };
                if (fields.color !== null) {
                    // The swatches, or the color the editor opened with.
                    if (!(AREA_PRESET_COLORS as readonly string[]).includes(fields.color) && fields.color !== draft.color) {
                        return fail('INVALID_INPUT', 'That color is not offered');
                    }
                    draft.color = fields.color;
                }
                const plan = planManageEditorSave(resolved, draft, useTaskStore.getState().settings);
                if (!plan) return fail('INVALID_INPUT', 'A name is required');
                const writes = pendingWrites(plan);
                if (writes.length === 0) return { ok: true, value: { changed: false } };
                const before = storeData();
                const written = await runStoreWrite(async () => {
                    const results = [];
                    for (const write of writes) results.push(await runEditorWrite(write));
                    return results;
                });
                // Adding a person who already exists asks the store, which writes nothing.
                return settleWrite(written, { changed: storeData().some((data, index) => data !== before[index]) });
            });
        },

        /** Delete an area, person, context or tag after the row's `deleteConfirm`. Target state. */
        async deleteManageItem(input: { requestId: string; target: NativeManageDeleteTarget }): Promise<NativeHostResult<{ changed: boolean }>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const target = isObjectRecord(input) ? readEditorTarget(input.target) : null;
            if (!target || (target.type !== 'area' && target.type !== 'person' && target.type !== 'context' && target.type !== 'tag')
                || typeof input.requestId !== 'string' || !deps.requestIdPattern.test(input.requestId)) {
                return fail('INVALID_INPUT', 'A request UUID and an area, person, context or tag are required');
            }
            return receipts.run<{ changed: boolean }>(input.requestId, JSON.stringify(['manageDelete', target]), async () => {
                const state = useTaskStore.getState();
                const present = target.type === 'area'
                    ? state.areas.some((area) => area.id === target.id)
                    : target.type === 'person'
                        ? state.people.some((person) => person.id === target.id)
                        : target.type === 'context' ? contextCarried(target.name) : tagCarried(target.name);
                if (!present) return { ok: true, value: { changed: false } };
                const written = await runStoreWrite(() => {
                    switch (target.type) {
                        case 'area': return state.deleteArea(target.id);
                        case 'person': return state.deletePerson(target.id);
                        case 'context': return state.deleteContext(target.name);
                        default: return state.deleteTag(target.name);
                    }
                });
                return settleWrite(written, { changed: true });
            });
        },
    };
}
