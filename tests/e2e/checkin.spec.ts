import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { db } from '../../server/db';
import { gradeLevels, students, studentCheckinPhones, checkIns, checkInChangeLogs } from '../../shared/schema';

test('creates a student via admin, then checks them in via the public kiosk', async ({ page }) => {
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

  await page.goto('/admin');
  await page.getByRole('link', { name: '학생 관리' }).click();

  const studentName = `e2e등원${Date.now()}`;
  const studentPhone = `010${Date.now().toString().slice(-8)}`;
  await page.getByLabel('이름').fill(studentName);
  await page.getByLabel('전화번호').fill(studentPhone);
  await page.getByLabel('학년').selectOption({ label: gradeName });
  await page.getByRole('button', { name: '학생 등록' }).click();

  const maskedName = `${Array.from(studentName)[0]}${'*'.repeat(Array.from(studentName).length - 2)}${Array.from(studentName)[Array.from(studentName).length - 1]}`;
  await expect(page.getByText(maskedName)).toBeVisible();

  await page.goto('/check-in');
  await page.getByLabel('전화번호 뒤 4자리').fill(studentPhone.slice(-4));
  await page.getByRole('button', { name: '등원' }).click();

  await page.getByRole('button', { name: maskedName }).click();
  await expect(page.getByText(/환영/)).toBeVisible();

  await page.goto('/check-in');
  await page.getByLabel('전화번호 뒤 4자리').fill(studentPhone.slice(-4));
  await page.getByRole('button', { name: '등원' }).click();
  await page.getByRole('button', { name: maskedName }).click();
  await expect(page.getByText(/이미.*등원했습니다/)).toBeVisible();

  // NOTE on cleanup below: same rationale as tests/e2e/students.spec.ts — `students.gradeLevelId`
  // is a NOT NULL foreign key with no cascade, so there's no soft-delete-preserving UI/API path
  // that frees it, and this test's fixture rows (grade level + student) have no real history worth
  // preserving. This test also drives a real kiosk check-in, which creates `check_ins` and (as of
  // the fix for the missing kiosk create-log) `check_in_change_logs` rows referencing the student,
  // so those must be deleted first, then `student_checkin_phones` (synced automatically on student
  // create), then the student, then the grade level — same FK-safe order as students.spec.ts's own
  // cleanup, plus the check-in tables this test additionally touches.
  const [gradeRow] = await db.select({ id: gradeLevels.id }).from(gradeLevels).where(eq(gradeLevels.name, gradeName));
  if (gradeRow) {
    const gradeStudents = await db.select({ id: students.id }).from(students).where(eq(students.gradeLevelId, gradeRow.id));
    for (const { id: studentId } of gradeStudents) {
      const studentCheckIns = await db.select({ id: checkIns.id }).from(checkIns).where(eq(checkIns.studentId, studentId));
      for (const { id: checkInId } of studentCheckIns) {
        await db.delete(checkInChangeLogs).where(eq(checkInChangeLogs.checkInId, checkInId));
      }
      await db.delete(checkIns).where(eq(checkIns.studentId, studentId));
      await db.delete(studentCheckinPhones).where(eq(studentCheckinPhones.studentId, studentId));
    }
    await db.delete(students).where(eq(students.gradeLevelId, gradeRow.id));
    await db.delete(gradeLevels).where(eq(gradeLevels.id, gradeRow.id));
  }
});
