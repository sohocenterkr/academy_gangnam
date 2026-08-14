import { test, expect } from '@playwright/test';

test('dev home page shows healthy server status', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('health-status')).toHaveText('서버 연결 정상');
});
