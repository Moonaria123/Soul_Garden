import { test, expect } from '@playwright/test';

/**
 * E2E Scenario 0: Security (Roadmap §12)
 * - Register → inspect IndexedDB → wrong password ×5 → lockout
 * - No plaintext password, no key/chat in localStorage
 */

const TEST_USER = {
  username: 'e2e_test_user',
  password: 'TestPass123!',
};

test.describe('Scenario 0: Security', () => {
  test('should register a new account', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByText('创建本地账户')).toBeVisible();

    await page.getByPlaceholder('用户名').fill(TEST_USER.username);
    await page.getByPlaceholder('密码', { exact: true }).fill(TEST_USER.password);
    await page.getByPlaceholder('确认密码').fill(TEST_USER.password);
    await page.getByRole('button', { name: '创建账户' }).click();

    // Should redirect to main page after registration
    await expect(page).toHaveURL('/home', { timeout: 10_000 });
  });

  test('should not store plaintext password in IndexedDB', async ({ page }) => {
    await page.goto('/home');

    // Evaluate IndexedDB to verify no plaintext password
    const hasPlaintext = await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      for (const dbInfo of dbs) {
        if (!dbInfo.name) continue;
        try {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open(dbInfo.name!);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          const storeNames = Array.from(db.objectStoreNames);
          for (const storeName of storeNames) {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const items = await new Promise<unknown[]>((resolve, reject) => {
              const req = store.getAll();
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });
            const serialized = JSON.stringify(items);
            if (serialized.includes('TestPass123!')) {
              return true;
            }
          }
          db.close();
        } catch {
          // Skip inaccessible databases
        }
      }
      return false;
    });

    expect(hasPlaintext).toBe(false);
  });

  test('should not store sensitive data in localStorage', async ({ page }) => {
    await page.goto('/home');

    const localStorageData = await page.evaluate(() => {
      const data: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        data[key] = localStorage.getItem(key)!;
      }
      return JSON.stringify(data);
    });

    // No API keys, passwords, or chat content in localStorage
    expect(localStorageData).not.toContain('apiKey');
    expect(localStorageData).not.toContain('password');
    expect(localStorageData).not.toContain('TestPass123');
  });

  test('should lock out after 5 failed login attempts', async ({ page }) => {
    // Logout first
    await page.goto('/login');

    for (let i = 0; i < 5; i++) {
      await page.getByPlaceholder('用户名').fill(TEST_USER.username);
      await page.getByPlaceholder('密码').fill('WrongPassword' + i);
      await page.getByRole('button', { name: '登录' }).click();
      // Wait for error message
      await page.waitForTimeout(500);
    }

    // Should see lockout message
    await expect(page.getByText(/请等待|稍后再试|安全/)).toBeVisible({ timeout: 5_000 });
  });
});
