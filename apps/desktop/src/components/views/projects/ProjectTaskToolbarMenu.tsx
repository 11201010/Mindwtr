import { Check, CheckCircle2, Columns3, MoreHorizontal, Plus } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import { getProjectMenuStyle } from './project-menu-position';

type ProjectTaskToolbarMenuProps = {
    triggerLabel: string;
    columnsLabel: string;
    columnsLayout: boolean;
    showColumns: boolean;
    onToggleColumns: () => void;
    completedLabel: string;
    showCompletedTasks: boolean;
    completedTaskCount: number;
    showCompletedControl: boolean;
    onToggleShowCompletedTasks: () => void;
    addSectionLabel: string;
    showAddSection: boolean;
    onAddSection: () => void;
};

const MENU_ITEM_CLASS = 'flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted focus:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

export function ProjectTaskToolbarMenu({
    triggerLabel,
    columnsLabel,
    columnsLayout,
    showColumns,
    onToggleColumns,
    completedLabel,
    showCompletedTasks,
    completedTaskCount,
    showCompletedControl,
    onToggleShowCompletedTasks,
    addSectionLabel,
    showAddSection,
    onAddSection,
}: ProjectTaskToolbarMenuProps) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);
    const [menuStyle, setMenuStyle] = useState<CSSProperties>({ position: 'fixed', top: 0, left: 0 });

    useLayoutEffect(() => {
        if (!open) return;
        const place = () => {
            const triggerRect = triggerRef.current?.getBoundingClientRect();
            const panelRect = panelRef.current?.getBoundingClientRect();
            if (!triggerRect || !panelRect) return;
            setMenuStyle(getProjectMenuStyle(
                triggerRect,
                panelRect,
                window.innerWidth,
                window.innerHeight,
            ));
        };
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        panelRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
        const handlePointer = (event: MouseEvent) => {
            const target = event.target as Node;
            if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            setOpen(false);
        };
        const handleKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setOpen(false);
            triggerRef.current?.focus();
        };
        window.addEventListener('mousedown', handlePointer);
        window.addEventListener('keydown', handleKey);
        return () => {
            window.removeEventListener('mousedown', handlePointer);
            window.removeEventListener('keydown', handleKey);
        };
    }, [open]);

    const runAction = (action: () => void) => {
        setOpen(false);
        triggerRef.current?.focus();
        action();
    };

    if (!showColumns && !showCompletedControl && !showAddSection) return null;

    return (
        <div ref={rootRef} className="relative">
            <button
                ref={triggerRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={triggerLabel}
                title={triggerLabel}
                onClick={() => setOpen((value) => !value)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
            {open && createPortal(
                <div
                    ref={panelRef}
                    role="menu"
                    style={menuStyle}
                    className="z-50 min-w-[210px] overscroll-contain rounded-md border border-border bg-card p-1 shadow-lg"
                >
                    {showColumns && (
                        <button
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={columnsLayout}
                            data-project-layout-toggle
                            onClick={() => runAction(onToggleColumns)}
                            className={MENU_ITEM_CLASS}
                        >
                            <Columns3 className="h-4 w-4" aria-hidden="true" />
                            <span className="flex-1">{columnsLabel}</span>
                            {columnsLayout && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                        </button>
                    )}
                    {showCompletedControl && (
                        <button
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={showCompletedTasks}
                            onClick={() => runAction(onToggleShowCompletedTasks)}
                            className={MENU_ITEM_CLASS}
                        >
                            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                            <span className="flex-1">{completedLabel}</span>
                            {!showCompletedTasks && completedTaskCount > 0 && (
                                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                    {completedTaskCount}
                                </span>
                            )}
                            {showCompletedTasks && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                        </button>
                    )}
                    {showAddSection && (
                        <>
                            {(showColumns || showCompletedControl) && <div className="my-1 border-t border-border/60" role="separator" />}
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => runAction(onAddSection)}
                                className={MENU_ITEM_CLASS}
                            >
                                <Plus className="h-4 w-4" aria-hidden="true" />
                                {addSectionLabel}
                            </button>
                        </>
                    )}
                </div>,
                document.body,
            )}
        </div>
    );
}
