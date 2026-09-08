import { useId, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, X } from 'lucide-react';
import { getOnboardingGuideUrl, ONBOARDING_TOPIC_COPY, type OnboardingTopic } from '@mindwtr/core';
import { dismissDesktopOnboardingHint, isDesktopOnboardingHintDismissed } from '../lib/desktop-onboarding-events';

type Props = { topic: OnboardingTopic; t: (key: string) => string; autoReveal?: boolean };

/** Dismissal collapses the hint, but help remains available in its original context. */
export function ContextualHelp({ topic, t, autoReveal = true }: Props) {
    return <TopicHelp key={topic} topic={topic} t={t} autoReveal={autoReveal} />;
}

function TopicHelp({ topic, t, autoReveal }: Props) {
    const [expanded, setExpanded] = useState(() => autoReveal && !isDesktopOnboardingHintDismissed(topic));
    const id = useId();
    const copy = ONBOARDING_TOPIC_COPY[topic];
    const label = `${t('onboarding.help')}: ${t(copy.title)}`;
    const close = () => {
        dismissDesktopOnboardingHint(topic);
        setExpanded(false);
    };
    const controlClass = 'inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';
    return (
        <aside className="py-1" aria-label={label}>
            <div className="flex items-center justify-between gap-2">
                <button type="button" className={controlClass} aria-expanded={expanded} aria-controls={id}
                    onClick={() => expanded ? close() : setExpanded(true)}>
                    {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                    {label}
                </button>
                {expanded && <button type="button" className={controlClass} aria-label={t('common.dismiss')} onClick={close}>
                    <X size={16} aria-hidden="true" />
                </button>}
            </div>
            {expanded && <div id={id} className="space-y-1 px-2 pb-2">
                <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{t(copy.body)}</p>
                <a href={getOnboardingGuideUrl(topic, 'desktop')} target="_blank" rel="noreferrer"
                    className="inline-flex min-h-9 items-center gap-1 rounded text-sm text-primary underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                    {t('onboarding.readGuide')} <ExternalLink size={14} aria-hidden="true" />
                </a>
            </div>}
        </aside>
    );
}
