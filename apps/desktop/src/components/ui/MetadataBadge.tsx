import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

type MetadataVariant = 'project' | 'context' | 'tag' | 'priority' | 'estimate' | 'age' | 'info';

interface MetadataBadgeProps {
    label: string;
    variant: MetadataVariant;
    icon?: LucideIcon;
    dotColor?: string;
    className?: string;
}

export function MetadataBadge({ label, variant, icon: Icon, dotColor, className }: MetadataBadgeProps) {
    return (
        <span
            className={cn('metadata-badge', `metadata-badge--${variant}`, className)}
        >
            {dotColor && (
                <span
                    className="metadata-badge__dot"
                    style={{ backgroundColor: dotColor }}
                    aria-hidden="true"
                />
            )}
            {Icon && <Icon className="metadata-badge__icon" aria-hidden="true" />}
            <span className="metadata-badge__label">{label}</span>
        </span>
    );
}
