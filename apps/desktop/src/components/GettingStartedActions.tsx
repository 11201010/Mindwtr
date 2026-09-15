import { ExternalLink, Inbox, Plus, Star } from 'lucide-react';
import { dispatchNavigateEvent } from '../lib/navigation-events';
import { getDocsGuideUrl } from '@mindwtr/core';
import { useDocumentationLanguage } from '../contexts/language-context';

export function GettingStartedActions({ t }: { t: (key: string) => string }) {
    const language = useDocumentationLanguage();
    const actionClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';
    return (
        <section aria-label={t('starter.projectTitle')} className="space-y-2 py-3">
            <p className="text-sm text-muted-foreground">{t('onboarding.tryWorkflow')}</p>
            <div className="flex flex-wrap gap-2">
                <button type="button" className={actionClass} onClick={() => window.dispatchEvent(new Event('mindwtr:quick-add'))}>
                    <Plus size={16} aria-hidden="true" />{t('onboarding.captureAction')}
                </button>
                <button type="button" className={actionClass} onClick={() => dispatchNavigateEvent('inbox')}>
                    <Inbox size={16} aria-hidden="true" />{t('starter.processInbox.check1')}
                </button>
                <button type="button" className={actionClass} onClick={() => dispatchNavigateEvent('agenda')}>
                    <Star size={16} aria-hidden="true" />{t('starter.focus.check1')}
                </button>
            </div>
            <a href={getDocsGuideUrl('start/getting-started', language, 'basic-workflow')} target="_blank" rel="noreferrer"
                className="inline-flex min-h-9 items-center gap-1 rounded text-sm text-primary underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                {t('onboarding.readGuide')} <ExternalLink size={14} aria-hidden="true" />
            </a>
        </section>
    );
}
