import { expect, test } from '@playwright/test';
import { dismissOnboarding, seedAppData } from './seed';

test('global search highlights each matched title term on task and project results', async ({ page }, testInfo) => {
    await dismissOnboarding(page);
    await seedAppData(page, {
        tasks: [{ id: 'search-task', title: 'Alpha garden BETA notes', status: 'next' }],
        projects: [{ id: 'search-project', title: 'Beta launch alpha' }],
    });
    await page.goto('/?view=next');
    await expect(page.locator('[data-task-id="search-task"]')).toBeVisible();
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog');
    const search = dialog.locator('input').first();
    await search.fill('alpha beta');
    const rows = dialog.locator('[data-search-index]');
    await expect(rows).toHaveCount(2);
    const task = rows.filter({ hasText: 'Alpha garden BETA notes' });
    const project = rows.filter({ hasText: 'Beta launch alpha' });
    await expect(task.locator('.text-primary.font-semibold')).toHaveText(['Alpha', 'BETA']);
    await expect(project.locator('.text-primary.font-semibold')).toHaveText(['Beta', 'alpha']);
    await page.screenshot({ path: testInfo.outputPath('global-search-multiple-highlights.png') });
    await task.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-task-id="search-task"]')).toBeVisible();
});

test('global search highlights separate Chinese title substrings', async ({ page }, testInfo) => {
    await dismissOnboarding(page);
    await seedAppData(page, {
        tasks: [{ title: '项目设计资料与会议记录', status: 'reference' }],
    });
    await page.goto('/?view=reference');
    await expect(page.locator('[data-task-id="seed-task-1"]')).toBeVisible();
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog');
    await dialog.locator('input').first().fill('资料 会议');
    const row = dialog.locator('[data-search-index]');
    await expect(row).toHaveCount(1);
    await expect(row.locator('.text-primary.font-semibold')).toHaveText(['资料', '会议']);
    await page.screenshot({ path: testInfo.outputPath('global-search-chinese-highlights.png') });
});
