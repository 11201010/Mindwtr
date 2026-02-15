import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '@mindwtr/core';
import { ChevronDown, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDropdownPosition } from './use-dropdown-position';

interface ProjectSelectorProps {
    projects: Project[];
    value: string;
    onChange: (projectId: string) => void;
    onCreateProject?: (title: string) => Promise<string | null>;
    placeholder?: string;
    noProjectLabel?: string;
    className?: string;
}

export function ProjectSelector({
    projects,
    value,
    onChange,
    onCreateProject,
    placeholder = 'Select project',
    noProjectLabel = 'No project',
    className,
}: ProjectSelectorProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const selected = projects.find((p) => p.id === value);
    const { dropdownClassName, listMaxHeight } = useDropdownPosition({
        open,
        containerRef,
        dropdownRef,
    });

    const normalizedQuery = query.trim().toLowerCase();
    const filtered = useMemo(() => {
        if (!normalizedQuery) return projects;
        return projects.filter((project) => project.title.toLowerCase().includes(normalizedQuery));
    }, [projects, normalizedQuery]);

    const hasExactMatch = useMemo(() => {
        if (!normalizedQuery) return false;
        return projects.some((project) => project.title.toLowerCase() === normalizedQuery);
    }, [projects, normalizedQuery]);

    useEffect(() => {
        if (!open) return;
        const handleClick = (event: MouseEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [open]);

    const handleCreate = async () => {
        if (!onCreateProject) return;
        const title = query.trim();
        if (!title) return;
        const id = await onCreateProject(title);
        if (id) {
            onChange(id);
        }
        setOpen(false);
        setQuery('');
    };

    return (
        <div ref={containerRef} className={cn('relative', className)}>
            <button
                type="button"
                onClick={() => setOpen((prev) => !prev)}
                className="w-full flex items-center justify-between text-xs bg-muted/50 border border-border rounded px-2 py-1 text-foreground"
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <span className="truncate">{selected?.title ?? placeholder}</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-70" />
            </button>
            {open && (
                <div
                    ref={dropdownRef}
                    className={cn('absolute z-20 w-full rounded-md border border-border bg-popover shadow-lg p-1 text-xs', dropdownClassName)}
                >
                    <input
                        autoFocus
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search projects"
                        className="w-full mb-1 rounded border border-border bg-muted/40 px-2 py-1 text-xs"
                    />
                    <button
                        type="button"
                        onClick={() => {
                            onChange('');
                            setOpen(false);
                            setQuery('');
                        }}
                        className={cn(
                            'w-full text-left px-2 py-1 rounded hover:bg-muted/50',
                            value === '' && 'bg-muted/70'
                        )}
                    >
                        {noProjectLabel}
                    </button>
                    {!hasExactMatch && query.trim() && onCreateProject && (
                        <button
                            type="button"
                            onClick={handleCreate}
                            className="w-full text-left px-2 py-1 rounded hover:bg-muted/50 text-primary flex items-center gap-2"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            Create Project &quot;{query.trim()}&quot;
                        </button>
                    )}
                    <div className="overflow-y-auto" style={{ maxHeight: listMaxHeight }}>
                        {filtered.map((project) => (
                            <button
                                key={project.id}
                                type="button"
                                onClick={() => {
                                    onChange(project.id);
                                    setOpen(false);
                                    setQuery('');
                                }}
                                className={cn(
                                    'w-full text-left px-2 py-1 rounded hover:bg-muted/50',
                                    project.id === value && 'bg-muted/70'
                                )}
                            >
                                {project.title}
                            </button>
                        ))}
                        {filtered.length === 0 && (
                            <div className="px-2 py-1 text-muted-foreground">No matches</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
