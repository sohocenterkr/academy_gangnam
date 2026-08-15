import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { db } from '../../server/db';
import { gradeLevels, students } from '../../shared/schema';

test('logs in, creates a student, links and unlinks a guardian, and confirms a duplicate-phone warning', async ({ page }) => {
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

  await page.goto('/admin/settings/academics');
  const gradeName = `e2e학년${Date.now()}`;
  await page.getByLabel('새 학년 이름').fill(gradeName);
  await page.getByRole('button', { name: '학년 추가' }).click();
  await expect(page.getByText(gradeName)).toBeVisible();

  // The "학생 관리" nav link only lives on the /admin dashboard, not on the
  // academics-settings page, so return there before following it.
  await page.goto('/admin');
  await page.getByRole('link', { name: '학생 관리' }).click();
  await expect(page).toHaveURL(/\/admin\/students$/);

  const studentName = `e2e학생${Date.now()}`;
  const studentPhone = `010${Date.now().toString().slice(-8)}`;

  await page.getByLabel('이름').fill(studentName);
  await page.getByLabel('전화번호').fill(studentPhone);
  await page.getByLabel('학년').selectOption({ label: gradeName });
  await page.getByRole('button', { name: '학생 등록' }).click();

  const maskedName = `${Array.from(studentName)[0]}${'*'.repeat(Array.from(studentName).length - 2)}${Array.from(studentName)[Array.from(studentName).length - 1]}`;
  await expect(page.getByText(maskedName)).toBeVisible();

  await page.getByRole('link', { name: maskedName }).click();
  await expect(page).toHaveURL(/\/admin\/students\/.+/);
  await expect(page.getByLabel('이름')).toHaveValue(studentName);
  const studentDetailUrl = page.url();

  // Registered once here so it covers the student-delete confirm dialog further down.
  page.on('dialog', (dialog) => dialog.accept());

  // Create a real guardian to link, then come back to the student detail page.
  await page.goto('/admin/guardians');
  const guardianName = `e2e보호자${Date.now()}`;
  const guardianPhone = `010${Date.now().toString().slice(-8)}`;
  await page.getByLabel('이름').fill(guardianName);
  await page.getByLabel('전화번호').fill(guardianPhone);
  await page.getByRole('button', { name: '보호자 등록' }).click();
  const maskedGuardianName = `${Array.from(guardianName)[0]}${'*'.repeat(Array.from(guardianName).length - 2)}${Array.from(guardianName)[Array.from(guardianName).length - 1]}`;
  await expect(page.getByText(maskedGuardianName)).toBeVisible();

  await page.goto(studentDetailUrl);
  await page.getByLabel('보호자 검색').fill(guardianName);
  await page.getByRole('button', { name: '보호자 검색' }).click();

  // The search-results panel reuses the general GET /api/guardians list endpoint, which
  // masks names, while the "연결된 보호자" section below embeds the full guardian record
  // from the student-detail response (unmasked) — so these two rows use different names.
  const searchResultRow = page.locator('li', { hasText: maskedGuardianName }).filter({ has: page.getByRole('button', { name: '연결', exact: true }) });
  await expect(searchResultRow).toBeVisible();
  await searchResultRow.getByRole('button', { name: '연결', exact: true }).click();

  const linkedRow = page.locator('li', { hasText: guardianName }).filter({ has: page.getByRole('button', { name: '연결 해제' }) });
  await expect(linkedRow).toBeVisible();

  await linkedRow.getByRole('button', { name: '연결 해제' }).click();
  await expect(page.locator('li', { hasText: guardianName }).filter({ has: page.getByRole('button', { name: '연결 해제' }) })).not.toBeVisible();

  await page.getByRole('link', { name: '목록으로' }).click();
  await expect(page).toHaveURL(/\/admin\/students$/);

  // The duplicate-phone check only looks at non-deleted students, so it must run while the
  // first student (created above with `studentPhone`) is still active — this has to happen
  // before the student-delete step further down.
  const secondStudentName = `e2e학생2-${Date.now()}`;
  await page.getByLabel('이름').fill(secondStudentName);
  await page.getByLabel('전화번호').fill(studentPhone);
  await page.getByLabel('학년').selectOption({ label: gradeName });
  await page.getByRole('button', { name: '학생 등록' }).click();

  await expect(page.getByText(/이미 등록된 전화번호/)).toBeVisible();

  // Exercise the "학생 삭제" UI flow (soft delete) on the first student.
  await page.goto(studentDetailUrl);
  await page.getByRole('button', { name: '학생 삭제' }).click();
  await expect(page).toHaveURL(/\/admin\/students$/);

  // NOTE on cleanup below: `students.gradeLevelId` is a NOT NULL foreign key with no cascade,
  // and this project's soft-delete model (`deleted_at`) intentionally keeps deleted rows in
  // place for history — so the "학생 삭제" click above never frees this grade level's FK, and
  // `DELETE /api/grade-levels/:id` would keep returning 409 IN_USE no matter when it's called.
  // There's no soft-delete-preserving UI/API path that frees a NOT-NULL FK, so — the same way
  // this project's own vitest integration tests reach into the DB directly to clean up their
  // fixture rows (see server/routes/students.test.ts's cleanup() helper) — this test deletes
  // its own zero-history fixture rows (the grade level and the one student that referenced it)
  // directly via the DB once the UI assertions above are done, instead of leaking them into the
  // shared dev DB on every run.
  const [gradeRow] = await db.select({ id: gradeLevels.id }).from(gradeLevels).where(eq(gradeLevels.name, gradeName));
  if (gradeRow) {
    await db.delete(students).where(eq(students.gradeLevelId, gradeRow.id));
    await db.delete(gradeLevels).where(eq(gradeLevels.id, gradeRow.id));
  }
});
