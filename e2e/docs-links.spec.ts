import { expect, test } from '@playwright/test';
import { dismissOnboarding, seedAppData } from './seed';

test('documentation links follow live app language changes and fall back to English', async ({ page }) => {
    await dismissOnboarding(page);
    await seedAppData(page, {});
    await page.context().route('https://docs.mindwtr.app/**', (route) => route.fulfill({ body: 'Documentation destination' }));
    await page.goto('/?view=settings');

    const expectDocsDestination = async (url: string) => {
        const popupPromise = page.waitForEvent('popup');
        await page.locator('[data-settings-key="documentation"] button').click();
        const popup = await popupPromise;
        await expect(popup).toHaveURL(url);
        await popup.close();
    };

    await page.locator('[data-settings-key="language"] select').selectOption('zh-Hant');
    await page.getByRole('button', { name: '關於', exact: true }).click();
    await expectDocsDestination('https://docs.mindwtr.app/zh-Hant/');

    await page.getByRole('button', { name: '通用', exact: true }).click();
    await page.locator('[data-settings-key="language"] select').selectOption('uk');
    await page.getByRole('button', { name: 'про', exact: true }).click();
    await expectDocsDestination('https://docs.mindwtr.app/');
});
