import { expect, test } from '@playwright/test';
import { dismissOnboarding, seedAppData } from './seed';

for (const style of ['standard', 'vim'] as const) {
  test(`Projects keyboard navigation (${style})`, async ({ page }, testInfo) => {
    await dismissOnboarding(page);
    await seedAppData(page, {
      projects: [{ id: 'alpha', title: 'Alpha project' }, { id: 'beta', title: 'Beta project' }],
      tasks: [{ id: 'alpha-task', title: 'Alpha action', status: 'next', projectId: 'alpha' }, { id: 'beta-task', title: 'Beta action', status: 'next', projectId: 'beta' }],
      settings: { keybindingStyle: style },
    });
    await page.goto('/?view=inbox');
    const nav = page.locator('[data-sidebar-item][data-view="projects"]');
    if (style === 'vim') {
      await page.locator('[data-main-content]').focus();
      await page.keyboard.press('g');
      await page.keyboard.press('p');
      await expect(nav).toHaveAttribute('aria-current', 'page');
    } else {
      await nav.click();
    }
    await nav.focus();
    await page.keyboard.press(style === 'vim' ? 'l' : 'ArrowRight');
    const alpha = page.locator('[data-project-navigation-item][data-project-id="alpha"]');
    const beta = page.locator('[data-project-navigation-item][data-project-id="beta"]');
    await expect(alpha).toBeFocused();
    await expect(page.locator('[data-project-workspace] [data-task-id="alpha-task"]')).toBeVisible();
    await page.keyboard.press(style === 'vim' ? 'j' : 'ArrowDown');
    await expect(beta).toBeFocused();
    await expect(page.locator('[data-project-workspace] [data-task-id="beta-task"]')).toBeVisible();
    if (style === 'vim') {
      await page.keyboard.press('x');
      await page.keyboard.press('d');
      await page.keyboard.press('d');
      const tasks = await page.evaluate(() => JSON.parse(localStorage.getItem('mindwtr-data')!).tasks);
      expect(tasks.every((task: { status: string; deletedAt?: string }) => task.status === 'next' && !task.deletedAt)).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath(`${style}-project-focus.png`) });
    await page.keyboard.press(style === 'vim' ? 'k' : 'ArrowUp');
    await expect(alpha).toBeFocused();
    await page.keyboard.press(style === 'vim' ? 'l' : 'ArrowRight');
    await expect(page.locator('[data-project-workspace] :focus')).toHaveCount(1);
    await alpha.focus();
    await page.keyboard.press('Tab');
    await expect(alpha).not.toBeFocused();
    await alpha.focus();
    await page.keyboard.press(style === 'vim' ? 'h' : 'ArrowLeft');
    await expect(nav).toBeFocused();
  });

  test(`Projects compact keyboard navigation (${style})`, async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 900 });
    await dismissOnboarding(page);
    await seedAppData(page, {
      projects: [{ id: 'alpha', title: 'Alpha project' }, { id: 'beta', title: 'Beta project' }],
      tasks: [{ id: 'alpha-task', title: 'Alpha action', status: 'next', projectId: 'alpha' }, { id: 'beta-task', title: 'Beta action', status: 'next', projectId: 'beta' }],
      settings: { keybindingStyle: style },
    });
    await page.goto('/?view=projects');

    const nav = page.locator('[data-sidebar-item][data-view="projects"]');
    const projectNavigation = page.locator('[data-project-navigation-root]');
    const alpha = page.locator('[data-project-navigation-item][data-project-id="alpha"]');
    const beta = page.locator('[data-project-navigation-item][data-project-id="beta"]');
    const entryKey = style === 'vim' ? 'l' : 'ArrowRight';
    const nextKey = style === 'vim' ? 'j' : 'ArrowDown';
    const previousKey = style === 'vim' ? 'k' : 'ArrowUp';

    await expect(projectNavigation).toHaveCount(1);
    await expect(projectNavigation).toBeHidden();
    await nav.focus();
    await page.keyboard.press(entryKey);
    await expect(projectNavigation).toBeVisible();
    await expect(alpha).toBeFocused();

    await page.keyboard.press(nextKey);
    await expect(beta).toBeFocused();
    await page.keyboard.press(previousKey);
    await expect(alpha).toBeFocused();
    await page.keyboard.press(nextKey);
    await expect(beta).toBeFocused();
    await expect(projectNavigation).toBeVisible();

    await page.keyboard.press('Tab');
    await expect(beta).not.toBeFocused();
    expect(await projectNavigation.evaluate((root) => root.contains(document.activeElement))).toBe(true);
    await expect(projectNavigation).toBeVisible();

    await beta.focus();
    await page.keyboard.press(entryKey);
    await expect(page.locator('[data-project-workspace] [data-task-id="beta-task"]')).toBeVisible();
    await expect(projectNavigation).toBeHidden();

    await nav.focus();
    await page.keyboard.press(entryKey);
    await expect(projectNavigation).toBeVisible();
    await expect(beta).toBeFocused();
  });
}
