import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Archive, CheckSquare } from 'lucide-react';

import { useLanguage } from '../../contexts/language-context';
import { cn } from '../../lib/utils';
import { ArchiveView } from './ArchiveView';
import { ListView } from './ListView';
import { ViewHeaderActionsTarget } from './list/ViewHeaderActions';

export type HistoryTab = 'done' | 'archived';

type HistoryViewProps = {
    selectedTab: HistoryTab;
    onSelectTab: (tab: HistoryTab) => void;
};

export function HistoryView({ selectedTab, onSelectTab }: HistoryViewProps) {
    const { t } = useLanguage();
    const idBase = useId();
    const panelId = `${idBase}-panel`;
    const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null);
    const tabRefs = useRef<Record<HistoryTab, HTMLButtonElement | null>>({
        done: null,
        archived: null,
    });
    const tabs = [
        { id: 'done' as const, label: t('nav.done'), icon: CheckSquare },
        { id: 'archived' as const, label: t('nav.archived'), icon: Archive },
    ];
    const selectAndFocus = (tab: HistoryTab) => {
        onSelectTab(tab);
        window.requestAnimationFrame(() => tabRefs.current[tab]?.focus());
    };
    const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: HistoryTab) => {
        const order: HistoryTab[] = ['done', 'archived'];
        const index = order.indexOf(current);
        let next: HistoryTab | undefined;
        if (event.key === 'ArrowRight') next = order[(index + 1) % order.length];
        else if (event.key === 'ArrowLeft') next = order[(index - 1 + order.length) % order.length];
        else if (event.key === 'Home') next = order[0];
        else if (event.key === 'End') next = order[order.length - 1];
        if (!next) return;
        event.preventDefault();
        selectAndFocus(next);
    };

    return (
        <ViewHeaderActionsTarget.Provider value={toolbarTarget}>
            <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3" data-history-header>
                    <div
                        role="tablist"
                        aria-label={t('nav.history')}
                        className="inline-flex rounded-lg border border-border bg-muted/30 p-1"
                    >
                        {tabs.map((tab) => {
                            const selected = selectedTab === tab.id;
                            const Icon = tab.icon;
                            return (
                                <button
                                    key={tab.id}
                                    ref={(node) => { tabRefs.current[tab.id] = node; }}
                                    id={`${idBase}-${tab.id}`}
                                    type="button"
                                    role="tab"
                                    aria-selected={selected}
                                    aria-controls={panelId}
                                    tabIndex={selected ? 0 : -1}
                                    onClick={() => onSelectTab(tab.id)}
                                    onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
                                    className={cn(
                                        'inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none',
                                        selected
                                            ? 'bg-background text-foreground shadow-sm'
                                            : 'text-muted-foreground hover:text-foreground',
                                    )}
                                >
                                    <Icon className="h-4 w-4" aria-hidden="true" />
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>
                    <div ref={setToolbarTarget} className="min-w-0 max-w-full" data-history-toolbar />
                </div>
                <div
                    id={panelId}
                    role="tabpanel"
                    aria-labelledby={`${idBase}-${selectedTab}`}
                >
                    {selectedTab === 'done'
                        ? <ListView title={t('list.done')} statusFilter="done" />
                        : <ArchiveView />}
                </div>
            </div>
        </ViewHeaderActionsTarget.Provider>
    );
}
