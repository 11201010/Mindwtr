import { describe, expect, it } from 'vitest';
import { getOnboardingGuideUrl } from './onboarding-guidance';
import { isGettingStartedProject } from './getting-started-seed';
import { STARTER_SEED_STRINGS } from './i18n/starter-seed-strings';
import type { Project, Task } from './types';

describe('onboarding guidance', () => {
    it('links to the relevant platform and section', () => {
        expect(getOnboardingGuideUrl('inbox-project', 'mobile')).toBe('https://docs.mindwtr.app/use/mobile#processing-inbox');
        expect(getOnboardingGuideUrl('scheduling', 'desktop')).toBe('https://docs.mindwtr.app/use/desktop#task-properties');
        expect(new URL(getOnboardingGuideUrl('inbox-project', 'desktop')).hash).toBe('#%F0%9F%93%A5-inbox');
        expect(new URL(getOnboardingGuideUrl('focus', 'desktop')).hash).toBe('#%F0%9F%8E%AF-focus');
        expect(getOnboardingGuideUrl('focus', 'desktop', 'es'))
            .toBe('https://docs.mindwtr.app/es/use/desktop#%F0%9F%8E%AF-foco');
        expect(getOnboardingGuideUrl('scheduling', 'mobile', 'de'))
            .toBe('https://docs.mindwtr.app/de/use/mobile#aufgaben-planen');
        expect(getOnboardingGuideUrl('details', 'mobile', 'uk'))
            .toBe('https://docs.mindwtr.app/use/mobile#task-editor-task-view');
    });

    it.each(Object.entries(STARTER_SEED_STRINGS))('recognizes existing %s tutorial content without rewriting it', (_, strings) => {
        const project = { id: 'p', title: strings['starter.projectTitle'], status: 'active' } as Project;
        const task = { id: 't', title: strings['starter.processInbox.title'], projectId: 'p' } as Task;
        const before = JSON.stringify({ project, task });
        expect(isGettingStartedProject(project, [task])).toBe(true);
        expect(JSON.stringify({ project, task })).toBe(before);
        expect(isGettingStartedProject({ ...project, status: 'archived' }, [task])).toBe(false);
        expect(isGettingStartedProject({ ...project, deletedAt: '2026-01-01' }, [task])).toBe(false);
        expect(isGettingStartedProject(project, [{ ...task, deletedAt: '2026-01-01' }])).toBe(false);
        expect(isGettingStartedProject(project, [{ ...task, projectId: 'other' }])).toBe(false);
    });

    it('does not add tutorial controls to an ordinary project with the same name', () => {
        expect(isGettingStartedProject({ id: 'p', title: 'Getting Started' } as Project, [
            { id: 't', title: 'My own task', projectId: 'p' } as Task,
        ])).toBe(false);
    });
});
