export const STATUS_DRAG_STEP_PX = 72;
export const STATUS_DRAG_TRIGGER_PX = 28;

type ResolveBoardDropColumnIndexArgs = {
    translationX: number;
    currentColumnIndex: number;
    columnCount: number;
    stepPx?: number;
    triggerPx?: number;
};

const clamp = (value: number, min: number, max: number): number => {
    if (value < min) return min;
    if (value > max) return max;
    return value;
};

export const resolveBoardDropColumnIndex = ({
    translationX,
    currentColumnIndex,
    columnCount,
    stepPx = STATUS_DRAG_STEP_PX,
    triggerPx = STATUS_DRAG_TRIGGER_PX,
}: ResolveBoardDropColumnIndexArgs): number => {
    if (!Number.isFinite(columnCount) || columnCount <= 0) {
        return currentColumnIndex;
    }
    const absDelta = Math.abs(translationX);
    if (absDelta < triggerPx) {
        return clamp(currentColumnIndex, 0, columnCount - 1);
    }

    const direction = translationX < 0 ? -1 : 1;
    const additionalSteps = Math.floor((absDelta - triggerPx) / Math.max(1, stepPx));
    const columnsMoved = direction * (1 + additionalSteps);
    const nextIndex = currentColumnIndex + columnsMoved;
    return clamp(nextIndex, 0, columnCount - 1);
};

type BoardColumnBounds = {
    index: number;
    top: number;
    bottom: number;
};

type ResolveBoardDropColumnIndexFromYArgs = {
    dragCenterY: number;
    currentColumnIndex: number;
    columnBounds: BoardColumnBounds[];
};

export const resolveBoardDropColumnIndexFromY = ({
    dragCenterY,
    currentColumnIndex,
    columnBounds,
}: ResolveBoardDropColumnIndexFromYArgs): number => {
    if (!Number.isFinite(dragCenterY) || columnBounds.length === 0) {
        return currentColumnIndex;
    }

    const sortedBounds = [...columnBounds]
        .filter((item) => Number.isFinite(item.top) && Number.isFinite(item.bottom) && item.bottom >= item.top)
        .sort((a, b) => a.top - b.top);

    if (sortedBounds.length === 0) {
        return currentColumnIndex;
    }

    const directMatch = sortedBounds.find((item) => dragCenterY >= item.top && dragCenterY <= item.bottom);
    if (directMatch) {
        return directMatch.index;
    }

    let nearest = sortedBounds[0];
    let nearestDistance = dragCenterY < nearest.top ? nearest.top - dragCenterY : dragCenterY - nearest.bottom;
    for (let i = 1; i < sortedBounds.length; i += 1) {
        const candidate = sortedBounds[i];
        const distance = dragCenterY < candidate.top ? candidate.top - dragCenterY : dragCenterY - candidate.bottom;
        if (distance < nearestDistance) {
            nearest = candidate;
            nearestDistance = distance;
        }
    }

    return nearest.index;
};
