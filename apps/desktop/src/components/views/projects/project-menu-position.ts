import type { CSSProperties } from 'react';

type MenuRect = Pick<DOMRect, 'bottom' | 'height' | 'left' | 'right' | 'top' | 'width'>;

const VIEWPORT_GUTTER = 8;
const MENU_GAP = 4;

export function getProjectMenuStyle(
    triggerRect: MenuRect,
    panelRect: MenuRect,
    viewportWidth: number,
    viewportHeight: number,
): CSSProperties {
    const availableBelow = Math.max(0, viewportHeight - triggerRect.bottom - MENU_GAP - VIEWPORT_GUTTER);
    const availableAbove = Math.max(0, triggerRect.top - MENU_GAP - VIEWPORT_GUTTER);
    const openAbove = panelRect.height > availableBelow && availableAbove > availableBelow;
    const availableHeight = openAbove ? availableAbove : availableBelow;
    const maxHeight = availableHeight;
    const renderedHeight = Math.min(panelRect.height, maxHeight);
    const top = openAbove
        ? Math.max(VIEWPORT_GUTTER, triggerRect.top - MENU_GAP - renderedHeight)
        : Math.min(
            triggerRect.bottom + MENU_GAP,
            Math.max(VIEWPORT_GUTTER, viewportHeight - VIEWPORT_GUTTER - renderedHeight),
        );
    const maxLeft = Math.max(VIEWPORT_GUTTER, viewportWidth - VIEWPORT_GUTTER - panelRect.width);
    const left = Math.min(Math.max(VIEWPORT_GUTTER, triggerRect.right - panelRect.width), maxLeft);

    return {
        position: 'fixed',
        top,
        left,
        maxHeight,
        overflowY: 'auto',
    };
}
