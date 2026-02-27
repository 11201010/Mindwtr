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
