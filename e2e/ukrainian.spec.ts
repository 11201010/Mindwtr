import { expect, test } from '@playwright/test';
import { dismissOnboarding, seedAppData } from './seed';

test.use({ locale: 'uk-UA' });

test('uses Ukrainian for a Ukrainian device locale on startup and reload', async ({ page }) => {
    await dismissOnboarding(page);
    await seedAppData(page, {});
    await page.goto('/?view=inbox');
    const inbox = page.locator('[data-sidebar-item][data-view="inbox"]');
    await expect(inbox).toContainText('Вхідні');
    await page.reload();
    await expect(inbox).toContainText('Вхідні');
});
