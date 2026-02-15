import { useUiStore } from '../store/ui-store';
import { cn } from '../lib/utils';

export function ToastHost() {
    const toasts = useUiStore((state) => state.toasts);
    const dismissToast = useUiStore((state) => state.dismissToast);

    if (toasts.length === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
            {toasts.map((toast) => (
                <div
                    key={toast.id}
                    className={cn(
                        "min-w-[220px] max-w-[360px] rounded-md border px-3 py-2 shadow-lg text-sm flex items-start gap-3",
                        toast.tone === 'success' && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
                        toast.tone === 'error' && "border-destructive/40 bg-destructive/10 text-destructive",
                        toast.tone === 'info' && "border-border bg-card text-foreground"
                    )}
                    role="status"
                    aria-live="polite"
                >
                    <span className="flex-1">{toast.message}</span>
                    {toast.action && (
                        <button
                            type="button"
                            onClick={() => {
                                toast.action?.onClick();
                                dismissToast(toast.id);
                            }}
                            className="text-xs font-medium text-primary hover:underline"
                        >
                            {toast.action.label}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => dismissToast(toast.id)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                        aria-label="Dismiss notification"
                    >
                        ×
                    </button>
                </div>
            ))}
        </div>
    );
}
