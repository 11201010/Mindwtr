import type { ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { cn } from '../../../lib/utils';

const SECTION_CONTAINER_PREFIX = 'section:';
export const NO_SECTION_CONTAINER = `${SECTION_CONTAINER_PREFIX}none`;
export const getSectionContainerId = (sectionId?: string | null) =>
    sectionId ? `${SECTION_CONTAINER_PREFIX}${sectionId}` : NO_SECTION_CONTAINER;
export const getSectionIdFromContainer = (containerId: string) =>
    containerId === NO_SECTION_CONTAINER ? null : containerId.replace(SECTION_CONTAINER_PREFIX, '');

type SectionDropZoneProps = {
    id: string;
    className?: string;
    children: ReactNode;
};

export function SectionDropZone({ id, className, children }: SectionDropZoneProps) {
    const { setNodeRef, isOver } = useDroppable({ id });
    return (
        <div ref={setNodeRef} className={cn(className, isOver && 'ring-2 ring-primary/40')}>
            {children}
        </div>
    );
}
