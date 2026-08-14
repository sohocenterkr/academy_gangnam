import { test, expect } from '@playwright/test';

test('an unauthenticated visitor to /admin is redirected to /login', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login$/);
});

test('logging in with the bootstrapped admin reaches /admin and logging out returns to /login', async ({ page }) => {
  const email = process.env.INITIAL_ADMIN_EMAIL;
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('INITIAL_ADMIN_EMAIL/INITIAL_ADMIN_PASSWORD must be set in .env for this test');
  }

  await page.goto('/login');
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '로그인' }).click();

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText(/님, 안녕하세요/)).toBeVisible();

  await page.goto('/admin/profile');
  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole('button', { name: '로그아웃' }).click();

  await expect(page).toHaveURL(/\/login$/);
});
