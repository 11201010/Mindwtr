import {
    buildAndroidWidgetPublication,
    getFocusWidgetFilter,
    isSandboxMode,
    logInfo,
    logWarn,
    resolveLanguageFromLocale,
    resolveWidgetLanguage,
    setFocusWidgetFilter,
    useTaskStore,
    type FilterCriteria,
    type Language,
    type SortField,
    type WidgetSystemColorScheme,
} from '@mindwtr/core';

/** What the publication reads from the device (HostWidgets.kt): what RN's widget service reads from React Native. */
export type WidgetInputs = {
    systemColorScheme: WidgetSystemColorScheme;
    systemLocale: string;
    listSelections: string[];
    /** Debug builds only (check-widgets-device.mjs): the widgets' language, in place of the app's. */
    language?: Language;
    /** True when the last publication handed over was not stored and drawn (it failed): it is sent again even if unchanged. */
    stale?: boolean;
};

/** Kotlin's half of RN's widget module (HostWidgets.kt): the device's inputs, and setPayload + updateWidgets in one call. */
export type WidgetBridge = {
    /** True once the boot's validated load finished: before it the store is empty, and an empty payload would blank the widgets. */
    ready(): boolean;
    inputs(): WidgetInputs;
    publish(payload: string): void;
    /** The language chosen in the app (RN's `mindwtr-language`), as the host last passed it to setLanguage; null for none. */
    storedLanguage(): string | null;
};

/**
 * Store changes arrive in bursts (a sync, a bulk edit); one publication covers them. RN coalesces its widget refresh after a
 * save the same way (storage-adapter.ts, one second).
 */
const PUBLISH_DELAY_MS = 1_000;

/**
 * RN's widget service on the engine: core builds the whole Android payload (buildAndroidWidgetPublication) from the store, with
 * the device's inputs and the device language passed every time (QuickJS cannot detect either), and Kotlin writes it where RN's
 * module reads it and redraws the widgets. A store change publishes after a short delay; the host publishes at once after a
 * CoreWork job and when the app comes to the front (RN publishes on resume). A payload equal to the last one is not sent again,
 * unless Kotlin says that one never reached the widgets.
 */
export const createWidgetPublisher = (bridge: WidgetBridge) => {
    let last: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const publish = (): boolean => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        if (isSandboxMode() || !bridge.ready()) return false;
        const state = useTaskStore.getState();
        const data = { tasks: state._allTasks, projects: state._allProjects, sections: state._allSections, areas: state._allAreas, settings: state.settings ?? {} };
        const input = bridge.inputs();
        const language = input.language ?? resolveWidgetLanguage(bridge.storedLanguage(), data.settings.language, resolveLanguageFromLocale(input.systemLocale));
        const publication = buildAndroidWidgetPublication(data, language, {
            systemColorScheme: input.systemColorScheme,
            focusFilter: getFocusWidgetFilter(),
            systemLocale: input.systemLocale,
            listSelections: input.listSelections,
        });
        const payload = JSON.stringify(publication);
        if (payload === last && !input.stale) return false;
        bridge.publish(payload);
        last = payload;
        logInfo('Native Android widget payload published', {
            scope: 'widget',
            context: { items: publication.items.length, language, scheme: input.systemColorScheme, locale: input.systemLocale, lists: input.listSelections },
        });
        return true;
    };

    const schedule = () => {
        if (timer !== null) return;
        timer = setTimeout(() => {
            timer = null;
            try { publish(); } catch (error) { logWarn('Native Android widget publication failed', { scope: 'widget', error }); }
        }, PUBLISH_DELAY_MS);
    };

    useTaskStore.subscribe((state, previous) => {
        if (state.lastDataChangeAt !== previous.lastDataChangeAt || state.settings !== previous.settings) schedule();
    });

    return {
        publish,
        /**
         * The Focus screen's current filter and sort (core's `controls.widgetFilter`), as RN's Focus screen hands it to
         * setFocusWidgetFilter: a change republishes. Core's null sortOrder is RN's absent one.
         */
        focusFilter(filter: { criteria: FilterCriteria; sortBy: SortField; sortOrder: 'asc' | 'desc' | null } | undefined) {
            if (filter && setFocusWidgetFilter({ criteria: filter.criteria, sortBy: filter.sortBy, sortOrder: filter.sortOrder ?? undefined })) schedule();
        },
    };
};
