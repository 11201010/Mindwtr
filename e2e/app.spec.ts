import { test, expect } from '@playwright/test';

const createInboxTask = async (page: import('@playwright/test').Page, title: string) => {
    const quickAddInput = page.getByPlaceholder(/add task/i);
    await quickAddInput.fill(title);
    await quickAddInput.press('Enter');
    await expect(page.locator('[data-task-id]', { hasText: title })).toBeVisible();
};

const deleteInboxTask = async (page: import('@playwright/test').Page, title: string) => {
    const taskItem = page.locator('[data-task-id]', { hasText: title });
    await taskItem.hover();
    await taskItem.getByRole('button', { name: /delete/i }).click();
    const confirmDialog = page.getByRole('dialog');
    if (await confirmDialog.isVisible().catch(() => false)) {
        await confirmDialog.getByRole('button', { name: /^delete$/i }).click();
    }
    await expect(taskItem).toHaveCount(0);
};

test('loads the inbox view', async ({ page }) => {
    await page.goto('/');
    const inboxNav = page.locator('[data-sidebar-item][data-view="inbox"]');
    await expect(inboxNav).toBeVisible();
    await expect(inboxNav).toHaveAttribute('aria-current', 'page');
});

test('navigates between sidebar views', async ({ page }) => {
    await page.goto('/');
    const projectsNav = page.locator('[data-sidebar-item][data-view="projects"]');
    await projectsNav.click();
    await expect(projectsNav).toHaveAttribute('aria-current', 'page');

    const inboxNav = page.locator('[data-sidebar-item][data-view="inbox"]');
    await inboxNav.click();
    await expect(inboxNav).toHaveAttribute('aria-current', 'page');
});

test('creates and deletes a task from inbox', async ({ page }) => {
    await page.goto('/');
    await createInboxTask(page, 'E2E Task');
    await deleteInboxTask(page, 'E2E Task');
});

test('restores a deleted task from trash', async ({ page }) => {
    await page.goto('/');
    const title = 'E2E Restore Task';
    await createInboxTask(page, title);
    await deleteInboxTask(page, title);

    const trashNav = page.locator('[data-sidebar-item][data-view="trash"]');
    await trashNav.click();
    await expect(trashNav).toHaveAttribute('aria-current', 'page');

    const row = page.locator('div.rounded-lg', { hasText: title }).first();
    await expect(row).toBeVisible();
    await row.hover();
    await row.getByTitle(/restore/i).click();

    const inboxNav = page.locator('[data-sidebar-item][data-view="inbox"]');
    await inboxNav.click();
    const taskItem = page.locator('[data-task-id]', { hasText: title });
    await expect(taskItem).toBeVisible();
});

test('filters trashed tasks by search query', async ({ page }) => {
    await page.goto('/');
    await createInboxTask(page, 'Trash Keep Alpha');
    await createInboxTask(page, 'Trash Keep Beta');
    await deleteInboxTask(page, 'Trash Keep Alpha');
    await deleteInboxTask(page, 'Trash Keep Beta');

    const trashNav = page.locator('[data-sidebar-item][data-view="trash"]');
    await trashNav.click();
    await expect(trashNav).toHaveAttribute('aria-current', 'page');

    const searchInput = page.getByPlaceholder(/search/i).first();
    await searchInput.fill('Alpha');

    await expect(page.locator('h3', { hasText: 'Trash Keep Alpha' })).toBeVisible();
    await expect(page.locator('h3', { hasText: 'Trash Keep Beta' })).toHaveCount(0);
});
