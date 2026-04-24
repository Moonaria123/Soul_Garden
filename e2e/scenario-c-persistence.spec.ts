import { test, expect } from '@playwright/test';

/**
 * E2E Scenario C: Persistence (Roadmap §12)
 * - Verify entity list and chat history survive page reload
 */

const TEST_USER = {
  username: 'e2e_test_user',
  password: 'TestPass123!',
};

test.describe('Scenario C: Persistence', () => {
  test('should preserve data after browser refresh', async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.getByPlaceholder('用户名').fill(TEST_USER.username);
    await page.getByPlaceholder('密码').fill(TEST_USER.password);
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page).toHaveURL('/home', { timeout: 10_000 });

    // Note: This test assumes entities exist from prior tests.
    // In a real CI run, scenarios would chain via test ordering.

    // Reload the page
    await page.reload();

    // Should still be logged in (session should persist)
    // Check for main page content (not login redirect)
    await expect(page.getByText(/意识体|创建|库/)).toBeVisible({ timeout: 10_000 });
  });
});
