import { expect, test } from '@playwright/test';
import { dismissOnboarding, seedAppData } from './seed';

for (const filter of [
    { name: 'Work selected', areaIds: ['work'], excludedAreaIds: [] },
    { name: 'Personal and No area excluded', areaIds: [], excludedAreaIds: ['personal', '__none__'] },
]) {
    test(`Inbox stays unified with ${filter.name}`, async ({ page }, testInfo) => {
        const filters = { areaIds: filter.areaIds, excludedAreaIds: filter.excludedAreaIds };
        await dismissOnboarding(page);
        await seedAppData(page, {
            areas: [{ id: 'work', name: 'Work' }, { id: 'personal', name: 'Personal' }],
            projects: [{ id: 'home-project', title: 'Home project', areaId: 'personal' }],
            tasks: [
                { id: 'unassigned', title: 'Unassigned capture', status: 'inbox' },
                { id: 'work-capture', title: 'Work capture', status: 'inbox', areaId: 'work' },
                { id: 'personal-capture', title: 'Personal capture', status: 'inbox', areaId: 'personal' },
                { id: 'project-capture', title: 'Project capture', status: 'inbox', projectId: 'home-project' },
                { id: 'work-next', title: 'Work action', status: 'next', areaId: 'work' },
                { id: 'personal-next', title: 'Personal action', status: 'next', areaId: 'personal' },
                { id: 'unassigned-next', title: 'Unassigned action', status: 'next' },
            ],
            settings: { filters, ai: { enabled: false }, gtd: { inboxProcessing: { defaultMode: 'guided' } } },
        });
        await page.goto('/?view=inbox');
        for (const id of ['unassigned', 'work-capture', 'personal-capture', 'project-capture']) {
            await expect(page.locator(`[data-task-id="${id}"]`)).toBeVisible();
        }
        await expect(page.locator('[data-main-content]').getByText('All areas', { exact: true })).toBeVisible();
        await expect(page.locator('[data-sidebar-item][data-view="inbox"]')).toContainText('4');
        await page.screenshot({ path: testInfo.outputPath('unified-inbox.png') });
        await page.getByRole('button', { name: 'Process Inbox (4)', exact: true }).click();
        const titles = new Set<string>();
        for (let index = 0; index < 4; index++) {
            const title = page.locator('input[value$=" capture"]');
            await expect(title).toBeVisible();
            const currentTitle = await title.inputValue();
            titles.add(currentTitle);
            if (index === 1) await page.getByRole('button', { name: 'Quick', exact: true }).click();
            if (index === 2) await page.getByRole('button', { name: 'Guided', exact: true }).click();
            if (index < 3) {
                await page.getByRole('button', { name: 'Skip', exact: true }).click();
                await expect(title).not.toHaveValue(currentTitle);
            }
        }
        expect([...titles].sort()).toEqual(['Personal capture', 'Project capture', 'Unassigned capture', 'Work capture']);
        await page.keyboard.press('Escape');
        await page.locator('[data-sidebar-item][data-view="agenda"]').click();
        await expect(page.locator('[data-task-id="work-next"]')).toBeVisible();
        await expect(page.locator('[data-task-id="personal-next"]')).toHaveCount(0);
        await expect(page.locator('[data-task-id="unassigned-next"]')).toHaveCount(0);
        const data = await page.evaluate(() => JSON.parse(localStorage.getItem('mindwtr-data') ?? '{}'));
        expect(data.settings.filters.areaIds).toEqual(filters.areaIds);
        expect(data.settings.filters.excludedAreaIds).toEqual(filters.excludedAreaIds);
        expect(data.tasks.find((task: { id: string }) => task.id === 'personal-capture').areaId).toBe('personal');
        expect(data.tasks.find((task: { id: string }) => task.id === 'project-capture').projectId).toBe('home-project');
        expect(data.tasks.find((task: { id: string }) => task.id === 'unassigned').areaId).toBeUndefined();
    });
}

for (const defaultAreaMode of ['none', 'active']) {
    test(`quick capture stays visible and preserves the ${defaultAreaMode} area default`, async ({ page }) => {
        await dismissOnboarding(page);
        await seedAppData(page, {
            areas: [{ id: 'work', name: 'Work' }],
            settings: {
                filters: { areaIds: ['work'], excludedAreaIds: [] },
                gtd: { defaultAreaMode },
            },
        });
        await page.goto('/?view=inbox');
        await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible();
        const input = page.getByRole('combobox', { name: 'Add Task', exact: true });
        await input.fill('Fresh captured thought');
        await input.press('Enter');
        await expect(page.locator('[data-task-id]', { hasText: 'Fresh captured thought' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Process Inbox (1)', exact: true })).toBeVisible();
        await expect.poll(async () => page.evaluate(() => {
            const data = JSON.parse(localStorage.getItem('mindwtr-data') ?? '{}');
            const task = data.tasks?.find((entry: { title: string }) => entry.title === 'Fresh captured thought');
            return task ? { areaId: task.areaId ?? null, status: task.status, areaIds: data.settings.filters.areaIds } : null;
        })).toEqual({ areaId: defaultAreaMode === 'active' ? 'work' : null, status: 'inbox', areaIds: ['work'] });
    });
}
