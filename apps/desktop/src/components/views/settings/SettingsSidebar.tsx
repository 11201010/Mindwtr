import type { ComponentType } from 'react';

import { cn } from '../../../lib/utils';

type NavItem = {
    id: string;
    icon: ComponentType<{ className?: string }>;
    label: string;
    description?: string;
};

type SettingsSidebarProps = {
    title: string;
    subtitle: string;
    items: NavItem[];
    activeId: string;
    onSelect: (id: string) => void;
};

export function SettingsSidebar({ title, subtitle, items, activeId, onSelect }: SettingsSidebarProps) {
    return (
        <aside className="col-span-12 lg:col-span-4 xl:col-span-3 space-y-4">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
                <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
            </div>
            <nav className="bg-card border border-border rounded-lg p-1">
                {items.map((item) => {
                    const Icon = item.icon;
                    const isActive = item.id === activeId;
                    return (
                        <button
                            key={item.id}
                            onClick={() => onSelect(item.id)}
                            className={cn(
                                "w-full flex items-start gap-3 px-3 py-2 rounded-md text-left transition-colors",
                                isActive
                                    ? "bg-primary/10 text-primary"
                                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                            )}
                        >
                            <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                            <div>
                                <div className="text-sm font-medium">{item.label}</div>
                                {item.description && (
                                    <div className="text-xs text-muted-foreground">{item.description}</div>
                                )}
                            </div>
                        </button>
                    );
                })}
            </nav>
        </aside>
    );
}
