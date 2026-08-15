import { test, expect } from '@playwright/test';

test('logs in, creates a guardian, edits it, and confirms a duplicate-phone warning', async ({ page }) => {
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

  await page.getByRole('link', { name: '보호자 관리' }).click();
  await expect(page).toHaveURL(/\/admin\/guardians$/);

  const guardianName = `e2e보호자${Date.now()}`;
  const guardianPhone = `010${Date.now().toString().slice(-8)}`;

  await page.getByLabel('이름').fill(guardianName);
  await page.getByLabel('전화번호').fill(guardianPhone);
  await page.getByRole('button', { name: '보호자 등록' }).click();

  const maskedName = `${Array.from(guardianName)[0]}${'*'.repeat(Array.from(guardianName).length - 2)}${Array.from(guardianName)[Array.from(guardianName).length - 1]}`;
  await expect(page.getByText(maskedName)).toBeVisible();

  await page.getByRole('link', { name: maskedName }).click();
  await expect(page).toHaveURL(/\/admin\/guardians\/.+/);
  await expect(page.getByLabel('이름')).toHaveValue(guardianName);

  await page.getByLabel('메모').fill('e2e 테스트 메모');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText('저장되었습니다.')).toBeVisible();

  await page.getByRole('link', { name: '목록으로' }).click();
  await expect(page).toHaveURL(/\/admin\/guardians$/);

  const secondGuardianName = `e2e보호자2-${Date.now()}`;
  await page.getByLabel('이름').fill(secondGuardianName);
  await page.getByLabel('전화번호').fill(guardianPhone);
  await page.getByRole('button', { name: '보호자 등록' }).click();

  await expect(page.getByText(/이미 등록된 전화번호/)).toBeVisible();
});
