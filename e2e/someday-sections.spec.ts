import { expect, test } from '@playwright/test';
import type { AppData } from '@mindwtr/core';
import { dismissOnboarding, seedAppData } from './seed';

test('right-click moves a Someday task into an empty section, supports Undo, and survives reload', async ({ page }) => {
    const timestamp = '2026-01-01T00:00:00.000Z';
    const payload = JSON.stringify({
        tasks: [{
            id: 'someday-move', title: 'Learn botanical drawing', status: 'someday',
            projectId: 'creative-project', sectionId: 'project-section',
            viewSectionIds: { someday: 'books', waiting: 'later' },
            dueDate: '2030-12-01', tags: [], contexts: [],
            createdAt: timestamp, updatedAt: timestamp,
        }],
        projects: [{
            id: 'creative-project', title: 'Creative skills', status: 'active', color: '#94a3b8',
            createdAt: timestamp, updatedAt: timestamp,
        }],
        sections: [{
            id: 'project-section', projectId: 'creative-project', title: 'Materials', order: 0,
            createdAt: timestamp, updatedAt: timestamp,
        }],
        areas: [], people: [],
        settings: { gtd: { viewSections: { someday: [
            { id: 'books', title: 'Books', order: 0 },
            { id: 'travel', title: 'Travel', order: 1 },
        ] } } },
    } satisfies AppData);
    await dismissOnboarding(page);
    await page.addInitScript((value) => {
        if (localStorage.getItem('mindwtr-data') === null) localStorage.setItem('mindwtr-data', value);
    }, payload);
    await page.goto('/?view=someday');

    const readTask = () => page.evaluate(() => {
        const data = JSON.parse(localStorage.getItem('mindwtr-data') || '{}');
        return data.tasks?.find((task: { id: string }) => task.id === 'someday-move');
    });
    const move = async (destination: string) => {
        await page.getByText('Learn botanical drawing', { exact: true }).click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Move to section…', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Move to section…' });
        await expect(dialog).toBeVisible();
        await dialog.getByRole('combobox', { name: 'Someday section' }).selectOption(destination);
        await dialog.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(dialog).toBeHidden();
    };
    await page.getByText('Learn botanical drawing', { exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move to section…', exact: true }).click();
    const moveDialog = page.getByRole('dialog', { name: 'Move to section…' });
    await expect(moveDialog).toHaveAccessibleDescription('1 selected');
    await page.keyboard.press('Tab');
    await expect(moveDialog.getByRole('combobox', { name: 'Someday section' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(moveDialog).toBeHidden();

    await move('travel');
    await expect.poll(async () => (await readTask())?.viewSectionIds).toEqual({ someday: 'travel', waiting: 'later' });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => (await readTask())?.viewSectionIds).toEqual({ someday: 'books', waiting: 'later' });

    await move('travel');
    await expect.poll(async () => (await readTask())?.viewSectionIds.someday).toBe('travel');
    await page.reload();
    await expect(page.locator('[data-task-id="someday-move"]')).toBeVisible();
    expect(await readTask()).toMatchObject({
        status: 'someday', projectId: 'creative-project', sectionId: 'project-section',
        dueDate: '2030-12-01', viewSectionIds: { someday: 'travel', waiting: 'later' },
    });

    await move('');
    await expect.poll(async () => (await readTask())?.viewSectionIds).toEqual({ waiting: 'later' });
    await page.reload();
    expect((await readTask())?.viewSectionIds).toEqual({ waiting: 'later' });
});

test('creates a section in an empty Someday list and adds a task from its heading', async ({ page }, testInfo) => {
    await dismissOnboarding(page);
    await seedAppData(page, {});
    await page.goto('/?view=someday');
    await page.getByRole('button', { name: 'More options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New section…', exact: true }).click();
    const createDialog = page.getByRole('dialog', { name: 'New section…' });
    await createDialog.getByRole('combobox').fill('Places to explore');
    await createDialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(createDialog).toBeHidden();

    await page.getByRole('combobox', { name: 'Group', exact: true }).click();
    await page.locator('[role="option"][data-value="viewSection"]').click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Add task to Places to explore', exact: true }).click();
    const capture = page.getByRole('dialog');
    await capture.getByPlaceholder('Add Task', { exact: true }).fill('Visit the botanical garden');
    await capture.getByPlaceholder('Add Task', { exact: true }).press('Enter');

    const readData = () => page.evaluate(() => JSON.parse(localStorage.getItem('mindwtr-data') || '{}'));
    await expect.poll(async () => (await readData()).tasks?.length).toBe(1);
    const saved = await readData();
    expect(saved.tasks[0]).toMatchObject({
        title: 'Visit the botanical garden', status: 'someday',
        viewSectionIds: { someday: saved.settings.gtd.viewSections.someday[0].id },
    });
    await page.reload();
    await expect(page.getByText('Visit the botanical garden', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('someday-section-task.png') });
});
