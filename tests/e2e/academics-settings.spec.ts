import { test, expect } from '@playwright/test';

test('logs in, adds and removes a school', async ({ page }) => {
  const email = process.env.INITIAL_ADMIN_EMAIL;
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('INITIAL_ADMIN_EMAIL/INITIAL_ADMIN_PASSWORD must be set in .env for this test');
  }

  // The delete button now shows a native window.confirm() guard (see
  // AcademicsSettingsPage.tsx); Playwright dismisses dialogs by default, so without
  // this handler the delete below would silently no-op and the test would fail.
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto('/login');
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto('/admin/settings/academics');

  const schoolName = `e2e-테스트학교-${Date.now()}`;
  await page.getByLabel('새 학교 이름').fill(schoolName);
  await page.getByRole('button', { name: '학교 추가' }).click();
  await expect(page.getByText(schoolName)).toBeVisible();

  const schoolRow = page.locator('li', { hasText: schoolName });
  await schoolRow.getByRole('button', { name: '삭제' }).click();
  await expect(page.getByText(schoolName)).not.toBeVisible();
});
