import { type ComponentType, useState, useMemo } from 'react';
import { Search } from 'lucide-react';

import { cn } from '../../../lib/utils';

type NavItem = {
    id: string;
    icon: ComponentType<{ className?: string }>;
    label: string;
    description?: string;
    keywords?: string[];
    badge?: boolean;
    badgeLabel?: string;
};

type SettingsSidebarProps = {
    title: string;
    subtitle: string;
    items: NavItem[];
    activeId: string;
    onSelect: (id: string) => void;
    searchPlaceholder?: string;
};

export function SettingsSidebar({ title, subtitle, items, activeId, onSelect, searchPlaceholder }: SettingsSidebarProps) {
    const [search, setSearch] = useState('');
    const filtered = useMemo(() => {
        if (!search.trim()) return items.map((item) => ({ item, matchedKeywords: [] as string[] }));
        const q = search.toLowerCase();
        return items
            .map((item) => {
                const labelMatch = item.label.toLowerCase().includes(q);
                const matchedKeywords = (item.keywords ?? []).filter((kw) => kw.toLowerCase().includes(q));
                return { item, matchedKeywords, matches: labelMatch || matchedKeywords.length > 0 };
            })
            .filter((entry) => entry.matches);
    }, [items, search]);

    return (
        <aside className="w-full lg:w-48 xl:w-52 shrink-0 space-y-4">
            <div>
                <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
                <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
            </div>
            <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={searchPlaceholder ?? 'Search settings\u2026'}
                    className="w-full h-8 pl-8 pr-3 text-xs bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
            </div>
            <nav className="space-y-0.5">
                {filtered.map(({ item, matchedKeywords }) => {
                    const Icon = item.icon;
                    const isActive = item.id === activeId;
                    return (
                        <button
                            key={item.id}
                            onClick={() => onSelect(item.id)}
                            className={cn(
                                "w-full flex items-start gap-2.5 px-3 py-2 rounded-lg text-left text-[13px] font-medium transition-colors",
                                isActive
                                    ? "bg-primary/10 text-primary"
                                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                            )}
                        >
                            <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span>{item.label}</span>
                                    {item.badge && (
                                        <span className="inline-flex items-center">
                                            <span
                                                aria-hidden="true"
                                                className="h-2 w-2 rounded-full bg-red-500"
                                            />
                                            <span className="sr-only">{item.badgeLabel ?? 'Update available'}</span>
                                        </span>
                                    )}
                                </div>
                                {matchedKeywords.length > 0 && (
                                    <div className="text-[11px] font-normal text-muted-foreground truncate mt-0.5">
                                        {matchedKeywords.slice(0, 3).join(' · ')}
                                    </div>
                                )}
                            </div>
                        </button>
                    );
                })}
            </nav>
        </aside>
    );
}
