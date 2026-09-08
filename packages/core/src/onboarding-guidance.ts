/** UI-only guidance. Never store tutorial progress in tasks or sync settings. */
export type OnboardingTopic = 'inbox-project' | 'focus' | 'scheduling' | 'details';

export const ONBOARDING_TOPIC_COPY = {
    'inbox-project': { title: 'inbox.title', body: 'inbox.projectHint' },
    focus: { title: 'agenda.title', body: 'onboarding.focusHint' },
    scheduling: { title: 'taskEdit.scheduling', body: 'onboarding.schedulingHint' },
    details: { title: 'taskEdit.details', body: 'onboarding.detailsHint' },
} as const;

// These are section links, not another learning center. The English guide is
// the fallback for app languages without a corresponding documentation locale.
export function getOnboardingGuideUrl(topic: OnboardingTopic, platform: 'desktop' | 'mobile'): string {
    const anchors = platform === 'mobile'
        ? { 'inbox-project': 'processing-inbox', focus: 'focus', scheduling: 'scheduling-tasks', details: 'task-editor-task-view' }
        : { 'inbox-project': '📥-inbox', focus: '🎯-focus', scheduling: 'task-properties', details: 'task-editor-view-edit' };
    return `https://docs.mindwtr.app/use/${platform}#${encodeURIComponent(anchors[topic])}`;
}
