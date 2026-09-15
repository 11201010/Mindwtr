import { useId, useState } from 'react';
import { tFallback, type ViewSectionDefinition } from '@mindwtr/core';

import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../../ui/Dialog';
import { SomedaySectionSelector } from '../../ui/SomedaySectionSelector';
import {
    SomedaySectionMoveSaveError,
    type SomedaySectionMove,
} from '../../../lib/someday-section-move';

type Props = {
    sections: readonly ViewSectionDefinition[];
    selectedCount: number;
    initialSectionId?: string;
    t: (key: string) => string;
    onCreateSection: (title: string) => Promise<string | null>;
    onApply: (sectionId: string | undefined, pendingMove?: SomedaySectionMove) => Promise<void>;
    onCancel: () => void;
};

/** Keeps the selected tasks and destination in place after a failed save. */
export function SomedaySectionMoveDialog({
    sections,
    selectedCount,
    initialSectionId,
    t,
    onCreateSection,
    onApply,
    onCancel,
}: Props) {
    const titleId = useId();
    const pickerId = useId();
    const [sectionId, setSectionId] = useState<string | undefined>(initialSectionId);
    const [pendingMove, setPendingMove] = useState<SomedaySectionMove>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const moveLabel = tFallback(t, 'viewSections.moveToSection', 'Move to section…');
    const failureLabel = tFallback(t, 'viewSections.moveFailed', 'Could not move tasks to the section.');

    const create = async (title: string): Promise<string | null> => {
        setBusy(true);
        setError(null);
        try {
            const created = await onCreateSection(title);
            if (!created) setError(tFallback(t, 'viewSections.updateFailed', 'Could not update Someday sections.'));
            return created;
        } catch {
            setError(tFallback(t, 'viewSections.updateFailed', 'Could not update Someday sections.'));
            return null;
        } finally {
            setBusy(false);
        }
    };

    const apply = async () => {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
            await onApply(sectionId, pendingMove);
        } catch (cause) {
            if (cause instanceof SomedaySectionMoveSaveError) setPendingMove(cause.pendingMove);
            setError(failureLabel);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog onClose={() => { if (!busy) onCancel(); }} labelledBy={titleId} closeOnBackdrop={!busy}>
            <DialogHeader>
                <h3 id={titleId} className="font-semibold">{moveLabel}</h3>
                <p className="text-xs text-muted-foreground">{selectedCount} {t('bulk.selected')}</p>
            </DialogHeader>
            <DialogBody className="space-y-3">
                <label htmlFor={pickerId} className="block text-sm font-medium">{moveLabel}</label>
                <SomedaySectionSelector
                    id={pickerId}
                    sections={sections}
                    value={sectionId}
                    disabled={busy || Boolean(pendingMove)}
                    onChange={(next) => { setSectionId(next); setError(null); }}
                    onCreateSection={create}
                    t={t}
                    className="h-9 w-full rounded-md border border-border bg-card px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            </DialogBody>
            <DialogFooter>
                <button type="button" onClick={onCancel} disabled={busy} className="rounded-md px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">
                    {pendingMove ? tFallback(t, 'common.close', 'Close') : t('common.cancel')}
                </button>
                <button type="button" onClick={() => { void apply(); }} disabled={busy} aria-busy={busy} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                    {pendingMove ? tFallback(t, 'common.retry', 'Retry') : t('common.save')}
                </button>
            </DialogFooter>
        </Dialog>
    );
}
