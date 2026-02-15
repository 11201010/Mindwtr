import { Check, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { generateUUID, type Task } from '@mindwtr/core';
import { cn } from '../../../lib/utils';

type ChecklistFieldProps = {
    t: (key: string) => string;
    taskId: string;
    checklist: Task['checklist'];
    updateTask: (taskId: string, updates: Partial<Task>) => void;
    resetTaskChecklist: (taskId: string) => void;
};

const areChecklistsEqual = (a: Task['checklist'], b: Task['checklist']): boolean => {
    if (a === b) return true;
    const listA = a || [];
    const listB = b || [];
    if (listA.length !== listB.length) return false;
    for (let i = 0; i < listA.length; i += 1) {
        const itemA = listA[i];
        const itemB = listB[i];
        if (!itemA || !itemB) return false;
        if (itemA.id !== itemB.id) return false;
        if (itemA.title !== itemB.title) return false;
        if (itemA.isCompleted !== itemB.isCompleted) return false;
    }
    return true;
};

export function ChecklistField({
    t,
    taskId,
    checklist,
    updateTask,
    resetTaskChecklist,
}: ChecklistFieldProps) {
    const [checklistDraft, setChecklistDraft] = useState<Task['checklist']>(checklist || []);
    const checklistDraftRef = useRef<Task['checklist']>(checklist || []);
    const checklistDirtyRef = useRef(false);
    const checklistInputRefs = useRef<Array<HTMLInputElement | null>>([]);

    useEffect(() => {
        setChecklistDraft(checklist || []);
        checklistDraftRef.current = checklist || [];
        checklistDirtyRef.current = false;
        checklistInputRefs.current = [];
    }, [taskId, checklist]);

    useEffect(() => {
        if (checklistDirtyRef.current) return;
        const incoming = checklist || [];
        if (areChecklistsEqual(incoming, checklistDraftRef.current)) return;
        setChecklistDraft(incoming);
        checklistDraftRef.current = incoming;
    }, [checklist]);

    const updateChecklistDraft = useCallback((next: Task['checklist']) => {
        setChecklistDraft(next);
        checklistDraftRef.current = next;
        checklistDirtyRef.current = true;
    }, []);

    const commitChecklistDraft = useCallback((next?: Task['checklist']) => {
        const payload = next ?? checklistDraftRef.current;
        if (!checklistDirtyRef.current && next === undefined) return;
        checklistDirtyRef.current = false;
        updateTask(taskId, { checklist: payload });
    }, [taskId, updateTask]);

    useEffect(() => () => {
        if (checklistDirtyRef.current) {
            updateTask(taskId, { checklist: checklistDraftRef.current });
        }
    }, [taskId, updateTask]);

    const focusChecklistIndex = useCallback((index: number) => {
        window.requestAnimationFrame(() => {
            checklistInputRefs.current[index]?.focus();
        });
    }, []);

    return (
        <div className="flex flex-col gap-2 w-full pt-2 border-t border-border/50">
            <label className="text-xs text-muted-foreground font-medium">{t('taskEdit.checklist')}</label>
            <div className="space-y-2 pr-3">
                {(checklistDraft || []).map((item, index) => (
                    <div key={item.id || index} className="flex items-center gap-2 group/item">
                        <button
                            type="button"
                            onClick={() => {
                                const newList = (checklistDraft || []).map((entry, i) =>
                                    i === index ? { ...entry, isCompleted: !entry.isCompleted } : entry
                                );
                                setChecklistDraft(newList);
                                checklistDraftRef.current = newList;
                                checklistDirtyRef.current = false;
                                updateTask(taskId, { checklist: newList });
                            }}
                            className={cn(
                                'w-4 h-4 border rounded flex items-center justify-center transition-colors',
                                item.isCompleted
                                    ? 'bg-primary border-primary text-primary-foreground'
                                    : 'border-muted-foreground hover:border-primary'
                            )}
                        >
                            {item.isCompleted && <Check className="w-3 h-3" />}
                        </button>
                        <input
                            type="text"
                            value={item.title}
                            ref={(node) => {
                                checklistInputRefs.current[index] = node;
                            }}
                            onChange={(event) => {
                                const newList = (checklistDraft || []).map((entry, i) =>
                                    i === index ? { ...entry, title: event.target.value } : entry
                                );
                                updateChecklistDraft(newList);
                            }}
                            onBlur={() => {
                                commitChecklistDraft();
                            }}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    const newItem = {
                                        id: generateUUID(),
                                        title: '',
                                        isCompleted: false,
                                    };
                                    const nextList = [...(checklistDraft || [])];
                                    nextList.splice(index + 1, 0, newItem);
                                    setChecklistDraft(nextList);
                                    checklistDraftRef.current = nextList;
                                    checklistDirtyRef.current = false;
                                    updateTask(taskId, { checklist: nextList });
                                    focusChecklistIndex(index + 1);
                                    return;
                                }
                                if (event.key === 'Backspace' && item.title.length === 0) {
                                    event.preventDefault();
                                    const nextList = (checklistDraft || []).filter((_, i) => i !== index);
                                    setChecklistDraft(nextList);
                                    checklistDraftRef.current = nextList;
                                    checklistDirtyRef.current = false;
                                    updateTask(taskId, { checklist: nextList });
                                    const nextIndex = Math.max(0, index - 1);
                                    if (nextList.length > 0) {
                                        focusChecklistIndex(nextIndex);
                                    }
                                    return;
                                }
                                if (event.key === 'Tab') {
                                    event.stopPropagation();
                                    const nextIndex = event.shiftKey ? index - 1 : index + 1;
                                    if (nextIndex >= 0 && nextIndex < (checklistDraft || []).length) {
                                        event.preventDefault();
                                        focusChecklistIndex(nextIndex);
                                    } else {
                                        commitChecklistDraft();
                                    }
                                }
                            }}
                            className={cn(
                                'flex-1 bg-transparent text-sm focus:outline-none border-b border-transparent focus:border-primary/50 px-1',
                                item.isCompleted && 'text-muted-foreground line-through'
                            )}
                            placeholder={t('taskEdit.itemNamePlaceholder')}
                        />
                        <button
                            type="button"
                            tabIndex={-1}
                            onClick={() => {
                                const newList = (checklistDraft || []).filter((_, i) => i !== index);
                                setChecklistDraft(newList);
                                checklistDraftRef.current = newList;
                                checklistDirtyRef.current = false;
                                updateTask(taskId, { checklist: newList });
                            }}
                            aria-label={t('common.delete')}
                            className="opacity-0 group-hover/item:opacity-100 text-muted-foreground hover:text-destructive p-1"
                        >
                            <Trash2 className="w-3 h-3" />
                        </button>
                    </div>
                ))}
                <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => {
                        const newItem = {
                            id: generateUUID(),
                            title: '',
                            isCompleted: false,
                        };
                        const nextList = [...(checklistDraft || []), newItem];
                        setChecklistDraft(nextList);
                        checklistDraftRef.current = nextList;
                        checklistDirtyRef.current = false;
                        updateTask(taskId, { checklist: nextList });
                        focusChecklistIndex(nextList.length - 1);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            event.stopPropagation();
                            const newItem = {
                                id: generateUUID(),
                                title: '',
                                isCompleted: false,
                            };
                            const nextList = [...(checklistDraft || []), newItem];
                            setChecklistDraft(nextList);
                            checklistDraftRef.current = nextList;
                            checklistDirtyRef.current = false;
                            updateTask(taskId, { checklist: nextList });
                            focusChecklistIndex(nextList.length - 1);
                        }
                    }}
                    className="text-xs text-blue-500 hover:text-blue-600 font-medium flex items-center gap-1"
                >
                    <Plus className="w-3 h-3" />
                    {t('taskEdit.addItem')}
                </button>
                {(checklistDraft || []).length > 0 && (
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            tabIndex={-1}
                            onClick={() => resetTaskChecklist(taskId)}
                            className="text-xs px-2 py-1 rounded bg-muted/50 hover:bg-muted transition-colors text-muted-foreground"
                        >
                            {t('taskEdit.resetChecklist')}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
