import { RefObject, useEffect, useState } from 'react';

type UseDropdownPositionOptions = {
    open: boolean;
    containerRef: RefObject<HTMLElement | null>;
    dropdownRef: RefObject<HTMLElement | null>;
};

const MIN_LIST_HEIGHT = 120;
const MAX_LIST_HEIGHT = 320;
const VIEWPORT_MARGIN_PX = 8;
const DROPDOWN_CHROME_PX = 84;

export function useDropdownPosition({ open, containerRef, dropdownRef }: UseDropdownPositionOptions) {
    const [openUpward, setOpenUpward] = useState(false);
    const [listMaxHeight, setListMaxHeight] = useState(192);

    useEffect(() => {
        if (!open) return;

        const updatePosition = () => {
            const trigger = containerRef.current;
            const dropdown = dropdownRef.current;
            if (!trigger || !dropdown) return;

            const triggerRect = trigger.getBoundingClientRect();
            const dropdownRect = dropdown.getBoundingClientRect();
            const estimatedHeight = dropdownRect.height || 260;

            const spaceAbove = triggerRect.top - VIEWPORT_MARGIN_PX;
            const spaceBelow = window.innerHeight - triggerRect.bottom - VIEWPORT_MARGIN_PX;
            const shouldOpenUp = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
            setOpenUpward(shouldOpenUp);

            const availableSpace = shouldOpenUp ? spaceAbove : spaceBelow;
            const nextListHeight = Math.max(
                MIN_LIST_HEIGHT,
                Math.min(MAX_LIST_HEIGHT, Math.floor(availableSpace - DROPDOWN_CHROME_PX))
            );
            setListMaxHeight(nextListHeight);
        };

        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [open, containerRef, dropdownRef]);

    return {
        dropdownClassName: openUpward ? 'bottom-full mb-1' : 'top-full mt-1',
        listMaxHeight,
    };
}
