import { useEffect, useId, useRef, useState } from 'react';

interface PromptModalProps {
    isOpen: boolean;
    title: string;
    description?: string;
    placeholder?: string;
    defaultValue?: string;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: (value: string) => void;
    onCancel: () => void;
}

export function PromptModal({
    isOpen,
    title,
    description,
    placeholder,
    defaultValue,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel,
}: PromptModalProps) {
    const [value, setValue] = useState(defaultValue ?? '');
    const inputRef = useRef<HTMLInputElement>(null);
    const titleId = useId();
    const descriptionId = useId();

    useEffect(() => {
        if (isOpen) {
            setValue(defaultValue ?? '');
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen, defaultValue]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/50 flex items-start justify-center pt-[20vh] z-50"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            onClick={onCancel}
        >
            <div
                className="w-full max-w-md bg-popover text-popover-foreground rounded-xl border shadow-2xl overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-4 py-3 border-b">
                    <h3 id={titleId} className="font-semibold">{title}</h3>
                    {description && (
                        <p id={descriptionId} className="text-xs text-muted-foreground mt-1">
                            {description}
                        </p>
                    )}
                </div>
                <div className="p-4 space-y-3">
                    <input
                        ref={inputRef}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                                e.preventDefault();
                                onCancel();
                            }
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                onConfirm(value);
                            }
                        }}
                        placeholder={placeholder}
                        className="w-full bg-card border border-border rounded-lg py-2 px-3 shadow-sm focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                    />
                    <div className="flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="px-3 py-1.5 rounded-md text-sm bg-muted hover:bg-muted/80"
                        >
                            {cancelLabel}
                        </button>
                        <button
                            type="button"
                            onClick={() => onConfirm(value)}
                            className="px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90"
                        >
                            {confirmLabel}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
