import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// A containing view can place its child's toolbar beside shared navigation
// without duplicating actions or taking ownership of the child's view state.
export const ViewHeaderActionsTarget = createContext<HTMLElement | null>(null);

export function ViewHeaderActions({ children }: { children: ReactNode }) {
    const target = useContext(ViewHeaderActionsTarget);
    return target ? createPortal(children, target) : children;
}
