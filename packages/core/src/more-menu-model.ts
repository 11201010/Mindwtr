/**
 * The mobile Menu tab's More sheet as data: its destinations, their order,
 * labels, icons and routes, and which view the quick-access tab holds.
 */
import { SETTINGS_MOBILE_QUICK_ACCESS_VIEW_VALUE_SET } from './settings-options';
import type { MobileQuickAccessView, SavedSearch } from './types';

type Translate = (key: string) => string;

const DEFAULT_MOBILE_QUICK_ACCESS_VIEW: MobileQuickAccessView = 'review';

/** The stored quick-access view, or Review for anything unknown. */
export function resolveMobileQuickAccessView(value: unknown): MobileQuickAccessView {
    return SETTINGS_MOBILE_QUICK_ACCESS_VIEW_VALUE_SET.has(value as MobileQuickAccessView)
        ? value as MobileQuickAccessView
        : DEFAULT_MOBILE_QUICK_ACCESS_VIEW;
}

export type MoreMenuItem = {
    /** The destination: a screen id, or a saved search's id. */
    id: string;
    /** Accessibility label; the tile shows `displayLabel`. */
    label: string;
    displayLabel: string;
    /** An SF Symbols name; mobile maps it to its own icon set. */
    icon: string;
    iconColor: string;
    /** Mobile's route for the destination. */
    route: string;
};

export type MoreMenuModel = {
    quickAccessView: MobileQuickAccessView;
    /** The compact row at the top: Trash, Board, History, Settings. */
    utilities: MoreMenuItem[];
    /** Shown only when there are saved searches. */
    savedSearchesTitle: string;
    savedSearches: MoreMenuItem[];
    /** The tile grid, three to a row. */
    primary: MoreMenuItem[];
};

const ICON_COLORS = {
    board: '#4F8CF7',
    review: '#22C55E',
    calendar: '#35B8B1',
    projects: '#10B981',
    contexts: '#8B5CF6',
    waiting: '#F2B705',
    someday: '#6366F1',
    reference: '#0EA5E9',
    history: '#22C55E',
    trash: '#EF4444',
    settings: '#64748B',
    saved: '#4F8CF7',
};

const QUICK_ACCESS_ROUTES: Record<MobileQuickAccessView, string> = {
    review: '/review',
    projects: '/projects-screen',
    calendar: '/calendar',
    contexts: '/contexts',
};

// "Someday/Maybe" is too long for a tile; the tile shows the part before the slash.
const compactSlashLabel = (label: string) => label.split('/')[0]?.trim() || label;

const item = (id: string, label: string, icon: string, iconColor: string, route: string, displayLabel = label): MoreMenuItem => ({
    id, label, displayLabel, icon, iconColor, route,
});

export function buildMoreMenuModel(input: {
    /** The stored setting (appearance.mobileQuickAccessView), resolved here. */
    quickAccessView: unknown;
    savedSearches: readonly SavedSearch[] | undefined;
    t: Translate;
}): MoreMenuModel {
    const { t } = input;
    const quickAccessView = resolveMobileQuickAccessView(input.quickAccessView);
    const quickAccessItems: Record<MobileQuickAccessView, MoreMenuItem> = {
        review: item('review', t('nav.review'), 'clipboard.fill', ICON_COLORS.review, QUICK_ACCESS_ROUTES.review),
        projects: item('projects', t('nav.projects'), 'folder.fill', ICON_COLORS.projects, QUICK_ACCESS_ROUTES.projects),
        calendar: item('calendar', t('nav.calendar'), 'calendar', ICON_COLORS.calendar, QUICK_ACCESS_ROUTES.calendar),
        contexts: item('contexts', t('nav.contexts'), 'circle', ICON_COLORS.contexts, QUICK_ACCESS_ROUTES.contexts),
    };
    // The view on the quick-access tab gives its tile to Projects.
    const quickAccessTile = (view: Exclude<MobileQuickAccessView, 'projects'>) => (
        quickAccessView === view ? quickAccessItems.projects : quickAccessItems[view]
    );
    return {
        quickAccessView,
        utilities: [
            item('trash', t('nav.trash'), 'trash.fill', ICON_COLORS.trash, '/trash'),
            item('board', t('tab.board'), 'square.grid.2x2.fill', ICON_COLORS.board, '/board'),
            item('history', t('nav.history'), 'clock.arrow.circlepath', ICON_COLORS.history, '/history'),
            item('settings', t('nav.settings'), 'gearshape.fill', ICON_COLORS.settings, '/settings'),
        ],
        savedSearchesTitle: t('search.savedSearches'),
        savedSearches: (input.savedSearches ?? []).map((search) => (
            item(search.id, search.name, 'tray.fill', ICON_COLORS.saved, `/saved-search/${search.id}`)
        )),
        primary: [
            item('waiting', t('nav.waiting'), 'pause.circle.fill', ICON_COLORS.waiting, '/waiting'),
            item('someday', t('nav.someday'), 'arrow.up.circle.fill', ICON_COLORS.someday, '/someday', compactSlashLabel(t('nav.someday'))),
            quickAccessTile('review'),
            item('reference', t('nav.reference'), 'book.closed.fill', ICON_COLORS.reference, '/reference'),
            quickAccessTile('contexts'),
            quickAccessTile('calendar'),
        ],
    };
}
