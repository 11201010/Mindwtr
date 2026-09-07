import { X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLanguage } from '../contexts/language-context';
import { useUiStore } from '../store/ui-store';
import { cn } from '../lib/utils';

export function ToastHost() {
    const { t } = useLanguage();
    const toasts = useUiStore((state) => state.toasts);
    const dismissToast = useUiStore((state) => state.dismissToast);
    const pauseToast = useUiStore((state) => state.pauseToast);
    const resumeToast = useUiStore((state) => state.resumeToast);
    const hostRef = useRef<HTMLDivElement>(null);
    const pointerInsideRef = useRef(false);
    const dismissLabel = t('common.dismiss');
    const dismissText = dismissLabel && dismissLabel !== 'common.dismiss' ? dismissLabel : 'Dismiss';

    useLayoutEffect(() => {
        if (toasts.length === 0) {
            pointerInsideRef.current = false;
            return;
        }
        if (pointerInsideRef.current || hostRef.current?.matches(':hover')) {
            pointerInsideRef.current = true;
            toasts.forEach((toast) => pauseToast(toast.id, 'pointer'));
        }
    }, [pauseToast, toasts]);

    useEffect(() => () => {
        const state = useUiStore.getState();
        state.toasts.forEach((toast) => {
            state.resumeToast(toast.id, 'pointer');
            state.resumeToast(toast.id, 'focus');
        });
    }, []);

    if (toasts.length === 0) return null;

    return (
        <div
            ref={hostRef}
            className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
            onPointerEnter={() => {
                pointerInsideRef.current = true;
                toasts.forEach((toast) => pauseToast(toast.id, 'pointer'));
            }}
            onPointerLeave={() => {
                pointerInsideRef.current = false;
                toasts.forEach((toast) => resumeToast(toast.id, 'pointer'));
            }}
        >
            {toasts.map((toast) => (
                <div
                    key={toast.id}
                    className={cn(
                        "min-w-[220px] max-w-[360px] rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg flex items-start gap-3 animate-in fade-in slide-in-from-bottom-2",
                        toast.tone === 'success' && "border-success",
                        toast.tone === 'error' && "border-destructive",
                        toast.tone === 'info' && "border-border"
                    )}
                    role="status"
                    aria-live="polite"
                    onFocusCapture={() => pauseToast(toast.id, 'focus')}
                    onBlurCapture={(event) => {
                        const nextTarget = event.relatedTarget;
                        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
                        resumeToast(toast.id, 'focus');
                    }}
                >
                    <span className="flex-1">{toast.message}</span>
                    {toast.action && (
                        <button
                            type="button"
                            onClick={() => {
                                toast.action?.onClick();
                                dismissToast(toast.id);
                            }}
                            className="text-xs font-medium text-primary hover:underline cursor-pointer"
                        >
                            {toast.action.label}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => dismissToast(toast.id)}
                        className="text-muted-foreground hover:text-foreground cursor-pointer transition-colors -mr-1"
                        aria-label={dismissText}
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            ))}
        </div>
    );
}
