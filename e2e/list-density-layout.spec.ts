import { test, expect } from '@playwright/test';
import { dismissOnboarding, seedAppData, seedTasks } from './seed';

// Each width is an independent case: fifteen full reloads in one test exhausted
// the default budget on CI, interrupting a healthy page during navigation.
for (const locale of [
    { language: 'en', title: 'Someday/Maybe' },
    { language: 'de', title: 'Irgendwann/Vielleicht' },
].flatMap((locale) => [1758, 1920, 1440, 1280, 800].map((width) => ({ ...locale, width })))) {
    const { width } = locale;
    test(`Someday density layout stays stable at ${width}px (${locale.language})`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await dismissOnboarding(page);
        await page.addInitScript((language) => localStorage.setItem('mindwtr-language', language), locale.language);
        await seedAppData(page, {
            tasks: seedTasks('Someday layout', 29, { status: 'someday' }),
            settings: { appearance: { density: 'comfortable' } },
        });
        await page.goto('/');
        await page.locator('[data-sidebar-item][data-view="someday"]').click();
        const header = page.locator('header').filter({ has: page.getByRole('heading', { name: locale.title, exact: true }) });
        await expect(header.getByRole('combobox')).toHaveCount(2);
        await page.evaluate(() => document.fonts.ready);

        const setDensity = async (density: 'comfortable' | 'compact' | 'condensed') => {
            await page.evaluate((nextDensity) => {
                const data = JSON.parse(localStorage.getItem('mindwtr-data') ?? '{}');
                data.settings = {
                    ...(data.settings ?? {}),
                    appearance: { ...(data.settings?.appearance ?? {}), density: nextDensity },
                };
                localStorage.setItem('mindwtr-data', JSON.stringify(data));
            }, density);
            await page.reload();
            await expect(header).toBeVisible();
            await expect.poll(() => page.evaluate(() => (
                JSON.parse(localStorage.getItem('mindwtr-data') ?? '{}').settings?.appearance?.density
            ))).toBe(density);
        };

        // Wait for the responsive sidebar's matchMedia update before taking
        // the baseline; density changes must not be blamed for that resize.
        await expect.poll(async () => Math.round((await page.getByRole('complementary').boundingBox())?.width ?? 0))
            .toBe(width < 1024 ? 64 : 256);
        const boxes = () => header.locator('button').evaluateAll((buttons) => buttons.map((button) => {
            const { x, y, width, height } = button.getBoundingClientRect();
            return { x, y, width, height };
        }));
        const before = await boxes();
        for (const density of ['compact', 'condensed', 'comfortable'] as const) {
            await setDensity(density);
            await expect.poll(async () => Math.round((await page.getByRole('complementary').boundingBox())?.width ?? 0))
                .toBe(width < 1024 ? 64 : 256);
            expect(await boxes(), `toolbar geometry at ${width}px in ${density}`).toEqual(before);
        }
        const bounds = await header.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        await page.screenshot({ path: testInfo.outputPath(`toolbar-${width}.png`) });
    });
}
