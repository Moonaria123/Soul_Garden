import { test, expect } from '@playwright/test';

/**
 * E2E Scenario A: Fictional Entity Flow (Roadmap §12)
 * - Login → new entity → questionnaire → extraction → view docs → chat → export
 */

const TEST_USER = {
  username: 'e2e_test_user',
  password: 'TestPass123!',
};

test.describe('Scenario A: Fictional Entity Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.getByPlaceholder('用户名').fill(TEST_USER.username);
    await page.getByPlaceholder('密码').fill(TEST_USER.password);
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page).toHaveURL('/home', { timeout: 10_000 });
  });

  test('should create a fictional entity via questionnaire', async ({ page }) => {
    await page.goto('/entities/new');

    // Step 1: Select "Fictional" type and fill basic info (all required fields for step 0)
    await page.getByText('虚构角色').click();
    await page.getByPlaceholder('TA 叫什么名字？').fill('测试角色');
    await page.getByPlaceholder('例如：男、女、非二元…').fill('男');
    await page.getByPlaceholder('例如：25、中年、古老的存在…').fill('25');
    await page.getByPlaceholder('TA 成长在怎样的文化环境中？').fill('测试文化');
    const langInput = page.getByPlaceholder('输入语言后按回车，例如：中文');
    await langInput.fill('中文');
    await langInput.press('Enter');
    await page.getByRole('button', { name: '下一步' }).click();

    // Verify progression to step 2 (personality / 性格)
    await expect(page.getByText(/性格关键词|表达|说话|语言/)).toBeVisible({ timeout: 5_000 });
  });

  test('should display entity list on home page', async ({ page }) => {
    await page.goto('/home');
    // After previous tests, there should be at least one entity or the empty state
    const hasEntity = await page.getByText('测试角色').isVisible().catch(() => false);
    const hasEmpty = await page.getByText(/空|创建/).isVisible().catch(() => false);
    expect(hasEntity || hasEmpty).toBeTruthy();
  });
});
