import { expect, test } from '@playwright/test';
import { dismissOnboarding, seedTheme } from './seed';

for (const theme of ['dark', 'light']) {
    test(`Focus compact filters preserve tri-state selection and task data (${theme})`, async ({ page }, testInfo) => {
        await dismissOnboarding(page);
        await seedTheme(page, theme);
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.addInitScript(() => {
            const stamp = '2026-09-01T12:00:00.000Z';
            const tasks = Array.from({ length: 30 }, (_, i) => ({
                id: `filter-task-${i}`, title: `Task ${i}`, status: 'next',
                contexts: [`@context-${i}`], tags: [`#tag-${i}`], projectId: `project-${i}`,
                priority: 'high', energyLevel: 'medium', timeEstimate: '30min', location: 'Office',
                createdAt: stamp, updatedAt: stamp,
            }));
            const projects = tasks.map((task, i) => ({
                id: task.projectId, title: `Project ${i} with a descriptive long name`, status: 'active',
                color: '#2563eb', createdAt: stamp, updatedAt: stamp,
            }));
            localStorage.setItem('mindwtr-data', JSON.stringify({
                tasks, projects, areas: [], sections: [], people: [],
                settings: { features: { priority: true, timeEstimates: true } },
            }));
        });
        await page.goto('/?view=agenda');
        const trigger = page.locator('button[aria-controls="agenda-filters-panel"]');
        await trigger.click();
        const panel = page.locator('#agenda-filters-panel');
        await expect(panel.getByRole('searchbox', { name: 'Search task titles', exact: true })).toBeVisible();
        const tokens = panel.getByRole('button', { name: /^Contexts & tags/ });
        await expect(tokens).toHaveAttribute('aria-expanded', 'false');
        await expect(panel.getByRole('button', { name: '@context-19', exact: true })).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath(`filters-collapsed-${theme}.png`) });
        await tokens.click();
        const optionSearch = panel.getByRole('searchbox', { name: 'Search options', exact: true });
        await optionSearch.fill('context-19');
        await expect(panel.getByRole('searchbox', { name: 'Search task titles', exact: true })).toHaveValue('');
        const token = panel.getByRole('button', { name: '@context-19', exact: true });
        await token.click();
        await expect(token).toHaveAttribute('aria-pressed', 'true');
        await panel.getByRole('button', { name: 'Remove filter: @context-19', exact: true }).click();
        await expect(token).toHaveAttribute('aria-pressed', 'false');
        await token.click();
        await token.click();
        await expect(panel.getByRole('button', { name: '@context-19 (Excluded)', exact: true })).toHaveAttribute('aria-pressed', 'mixed');
        await panel.getByRole('button', { name: 'Remove filter: @context-19', exact: true }).click();
        await expect(token).toHaveAttribute('aria-pressed', 'false');
        const projects = panel.getByRole('button', { name: /^Projects/ });
        await projects.click();
        await expect(tokens).toHaveAttribute('aria-expanded', 'false');
        await optionSearch.fill('Project 19');
        await panel.getByRole('button', { name: 'Project 19 with a descriptive long name', exact: true }).click();
        await expect(panel.getByRole('button', { name: 'Remove filter: Project 19 with a descriptive long name', exact: true })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`filters-project-${theme}.png`) });
        await panel.getByRole('button', { name: 'Hide', exact: true }).click();
        await expect(trigger).toBeFocused();
        await expect(panel.getByRole('button', { name: 'Remove filter: Project 19 with a descriptive long name', exact: true })).toBeVisible();
        await panel.getByRole('button', { name: 'Remove filter: Project 19 with a descriptive long name', exact: true }).click();
        await trigger.click();
        await page.keyboard.press('Escape');
        await expect(trigger).toBeFocused();
        const tasks = await page.evaluate(() => JSON.parse(localStorage.getItem('mindwtr-data') ?? '{}').tasks);
        expect(tasks).toHaveLength(30);
        expect(tasks[19]).toMatchObject({ status: 'next', contexts: ['@context-19'], tags: ['#tag-19'], projectId: 'project-19' });
    });
}
