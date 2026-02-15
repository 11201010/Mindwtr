import { DndContext, type DragEndEvent, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Area } from '@mindwtr/core';
import type { MouseEventHandler, ChangeEventHandler } from 'react';
import { SortableAreaRow } from './SortableRows';

type AreaManagerModalProps = {
    sortedAreas: Area[];
    areaSensors: ReturnType<typeof import('@dnd-kit/core').useSensors>;
    onDragEnd: (event: DragEndEvent) => void;
    onDeleteArea: (areaId: string) => void;
    onUpdateArea: (areaId: string, updates: Partial<Area>) => void;
    newAreaColor: string;
    onChangeNewAreaColor: ChangeEventHandler<HTMLInputElement>;
    newAreaName: string;
    onChangeNewAreaName: ChangeEventHandler<HTMLInputElement>;
    onCreateArea: () => void;
    isCreatingArea?: boolean;
    onSortByName: () => void;
    onSortByColor: () => void;
    onClose: () => void;
    t: (key: string) => string;
};

export function AreaManagerModal({
    sortedAreas,
    areaSensors,
    onDragEnd,
    onDeleteArea,
    onUpdateArea,
    newAreaColor,
    onChangeNewAreaColor,
    newAreaName,
    onChangeNewAreaName,
    onCreateArea,
    isCreatingArea = false,
    onSortByName,
    onSortByColor,
    onClose,
    t,
}: AreaManagerModalProps) {
    const stopPropagation: MouseEventHandler<HTMLDivElement> = (event) => {
        event.stopPropagation();
    };

    return (
        <div
            className="fixed inset-0 bg-black/50 flex items-start justify-center pt-[15vh] z-50"
            role="dialog"
            aria-modal="true"
            onClick={onClose}
        >
            <div
                className="w-full max-w-lg bg-popover text-popover-foreground rounded-xl border shadow-2xl overflow-hidden flex flex-col"
                onClick={stopPropagation}
            >
                <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <h3 className="font-semibold">Manage Areas</h3>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={onSortByName}
                                className="text-xs px-2 py-1 rounded border border-border bg-muted/50 hover:bg-muted"
                            >
                                {t('projects.sortByName')}
                            </button>
                            <button
                                type="button"
                                onClick={onSortByColor}
                                className="text-xs px-2 py-1 rounded border border-border bg-muted/50 hover:bg-muted"
                            >
                                {t('projects.sortByColor')}
                            </button>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-muted-foreground hover:text-foreground"
                    >
                        ✕
                    </button>
                </div>
                <div className="p-4 space-y-4">
                    <div className="space-y-2">
                        {sortedAreas.length === 0 && (
                            <div className="text-sm text-muted-foreground">
                                {t('projects.noArea')}
                            </div>
                        )}
                        {sortedAreas.length > 0 && (
                            <DndContext sensors={areaSensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                                <SortableContext items={sortedAreas.map((area) => area.id)} strategy={verticalListSortingStrategy}>
                                    {sortedAreas.map((area) => (
                                        <SortableAreaRow
                                            key={area.id}
                                            area={area}
                                            onDelete={onDeleteArea}
                                            onUpdateName={(areaId, name) => onUpdateArea(areaId, { name })}
                                            onUpdateColor={(areaId, color) => onUpdateArea(areaId, { color })}
                                            t={t}
                                        />
                                    ))}
                                </SortableContext>
                            </DndContext>
                        )}
                    </div>
                    <div className="border-t border-border/50 pt-3 space-y-2">
                        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                            New Area
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={newAreaColor}
                                onChange={onChangeNewAreaColor}
                                className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                            />
                            <input
                                type="text"
                                value={newAreaName}
                                onChange={onChangeNewAreaName}
                                placeholder="Area name"
                                className="flex-1 bg-muted/50 border border-border rounded px-2 py-1 text-sm"
                            />
                            <button
                                type="button"
                                onClick={onCreateArea}
                                disabled={isCreatingArea}
                                className="px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90"
                            >
                                {isCreatingArea ? (t('common.loading') || 'Loading...') : t('projects.create')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
