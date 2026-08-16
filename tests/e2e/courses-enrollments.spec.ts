import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { getTodayKST } from '../../shared/kst';
import { db } from '../../server/db';
import {
  gradeLevels,
  students,
  studentCheckinPhones,
  instructors,
  courses,
  courseSchedules,
  courseExceptions,
  enrollments,
} from '../../shared/schema';

test('logs in, enrolls a student in a course, verifies it on the course detail page, ends it, and confirms history is preserved', async ({ page }) => {
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

  // Grade level + student, reusing the exact pattern from students.spec.ts/checkin.spec.ts.
  await page.goto('/admin/settings/academics');
  const gradeName = `e2e학년${Date.now()}`;
  await page.getByLabel('새 학년 이름').fill(gradeName);
  await page.getByRole('button', { name: '학년 추가' }).click();
  await expect(page.getByText(gradeName)).toBeVisible();

  await page.goto('/admin');
  await page.getByRole('link', { name: '학생 관리' }).click();
  await expect(page).toHaveURL(/\/admin\/students$/);

  const studentName = `e2e수강생${Date.now()}`;
  const studentPhone = `010${Date.now().toString().slice(-8)}`;
  await page.getByLabel('이름').fill(studentName);
  await page.getByLabel('전화번호').fill(studentPhone);
  await page.getByLabel('학년').selectOption({ label: gradeName });
  await page.getByRole('button', { name: '학생 등록' }).click();

  const maskedStudentName = `${Array.from(studentName)[0]}${'*'.repeat(Array.from(studentName).length - 2)}${Array.from(studentName)[Array.from(studentName).length - 1]}`;
  await expect(page.getByText(maskedStudentName)).toBeVisible();

  await page.getByRole('link', { name: maskedStudentName }).click();
  await expect(page).toHaveURL(/\/admin\/students\/.+/);
  const studentId = page.url().split('/admin/students/')[1];
  if (!studentId) throw new Error('Failed to extract studentId from URL');

  // Instructor. The instructor list page has no detail link exposing the created row's id, so
  // grab it from the DB by its unique fixture phone number (same DB-reach-in pattern this
  // project's e2e specs already use for cleanup, applied here to read back an id for setup).
  await page.goto('/admin');
  await page.getByRole('link', { name: '강사 관리' }).click();
  await expect(page).toHaveURL(/\/admin\/instructors$/);

  const instructorName = `e2e강사${Date.now()}`;
  const instructorPhone = `010${Date.now().toString().slice(-8)}`;
  await page.getByLabel('이름').fill(instructorName);
  await page.getByLabel('전화번호').fill(instructorPhone);
  await page.getByLabel('담당 과목 (쉼표로 구분)').fill('수학');
  await page.getByRole('button', { name: '강사 등록' }).click();
  await expect(page.getByText(instructorName)).toBeVisible();

  const [instructorRow] = await db.select({ id: instructors.id }).from(instructors).where(eq(instructors.phoneNormalized, instructorPhone));
  if (!instructorRow) throw new Error('Failed to find created instructor in DB');
  const instructorId = instructorRow.id;

  // Course, linked to the instructor above.
  await page.goto('/admin');
  await page.getByRole('link', { name: '강좌 관리' }).click();
  await expect(page).toHaveURL(/\/admin\/courses$/);

  const courseCode = `e2e-course-${Date.now()}`;
  const courseName = `e2e강좌${Date.now()}`;
  await page.getByLabel('강좌 코드').fill(courseCode);
  await page.getByLabel('강좌명').fill(courseName);
  await page.getByLabel('분류').fill('수학');
  await page.getByLabel('담당 강사 ID').fill(instructorId);
  await page.getByRole('button', { name: '강좌 등록' }).click();

  await page.getByRole('link', { name: courseName }).click();
  await expect(page).toHaveURL(/\/admin\/courses\/.+/);
  const courseDetailUrl = page.url();
  const courseId = courseDetailUrl.split('/admin/courses/')[1];
  if (!courseId) throw new Error('Failed to extract courseId from URL');

  await expect(page.getByText('활성 수강 등록: 0건')).toBeVisible();

  // Weekly schedule.
  await page.getByLabel('요일').selectOption({ label: '월' });
  await page.getByLabel('시작 시간').fill('16:00');
  await page.getByLabel('종료 시간').fill('17:00');
  await page.getByLabel('강의실').fill('301호');
  await page.getByRole('button', { name: '일정 추가' }).click();
  await expect(page.getByText('월요일 16:00-17:00')).toBeVisible();

  // One exception (휴강). Per the known scope limitation, this only needs to be visible within
  // this same page session — there is no list endpoint to reload it from.
  await page.getByLabel('구분').selectOption({ label: '휴강' });
  const exceptionDate = getTodayKST();
  await page.getByLabel('날짜').fill(exceptionDate);
  await page.getByLabel('사유').fill('e2e 테스트 휴강');
  await page.getByRole('button', { name: '휴강·보강 추가' }).click();
  await expect(page.getByText('e2e 테스트 휴강')).toBeVisible();

  // Enroll the student.
  const enrollStartDate = getTodayKST();
  await page.getByLabel('학생 ID').fill(studentId);
  await page.getByLabel('시작일').fill(enrollStartDate);
  await page.getByLabel('수강료').fill('300000');
  await page.getByRole('button', { name: '수강 등록' }).click();

  await expect(page.getByText(new RegExp(`학생 ID: ${studentId}`))).toBeVisible();

  // `activeEnrollmentCount` is part of the course object, which only reloads on an explicit
  // `reloadCourse()` call (schedule add/delete) or a fresh page load — enrolling/ending only
  // reloads the enrollment list. This matches the project's "refresh is user-triggered only"
  // rule (no auto real-time UI polling), so a reload is needed to observe the updated count.
  await page.reload();
  await expect(page.getByText('활성 수강 등록: 1건')).toBeVisible();

  // Trigger the overlap warning on purpose with a second, overlapping enrollment for the same
  // student/course, then confirm past it via the "그래도 등록" button.
  await page.getByLabel('학생 ID').fill(studentId);
  await page.getByLabel('시작일').fill(enrollStartDate);
  await page.getByRole('button', { name: '수강 등록' }).click();

  await expect(page.getByText('기존 수강 기간과 겹칩니다:')).toBeVisible();
  await page.getByRole('button', { name: '그래도 등록' }).click();

  const enrollmentRows = page.locator('li', { hasText: `학생 ID: ${studentId}` });
  await expect(enrollmentRows).toHaveCount(2);

  await page.reload();
  await expect(page.getByText('활성 수강 등록: 2건')).toBeVisible();

  // End one of the two enrollments and confirm the active count drops back to 1.
  await enrollmentRows.first().getByRole('button', { name: '종료' }).click();
  await expect(page.getByText(/학생 ID:.*상태: ended/)).toBeVisible();

  await page.reload();
  await expect(page.getByText('활성 수강 등록: 1건')).toBeVisible();

  // The client has no enrollment-history UI on the student detail page yet (out of scope for
  // this stage's task list), so confirm history preservation by calling the API directly —
  // page.request shares the browser context's session cookie, so this is still an authenticated
  // call as the logged-in admin.
  const historyResponse = await page.request.get(`/api/students/${studentId}/enrollments`);
  expect(historyResponse.ok()).toBe(true);
  const historyBody = (await historyResponse.json()) as { data: Array<{ id: string; status: string; courseId: string }> };
  const historyForCourse = historyBody.data.filter((row) => row.courseId === courseId);
  expect(historyForCourse).toHaveLength(2);
  expect(historyForCourse.some((row) => row.status === 'ended')).toBe(true);
  expect(historyForCourse.some((row) => row.status === 'active')).toBe(true);

  // FK-safe cleanup, in dependency order: enrollments -> course schedules/exceptions -> course ->
  // instructor -> student (+ its checkin-phone sync row) -> grade level.
  await db.delete(enrollments).where(eq(enrollments.courseId, courseId));
  await db.delete(courseExceptions).where(eq(courseExceptions.courseId, courseId));
  await db.delete(courseSchedules).where(eq(courseSchedules.courseId, courseId));
  await db.delete(courses).where(eq(courses.id, courseId));
  await db.delete(instructors).where(eq(instructors.id, instructorId));
  await db.delete(studentCheckinPhones).where(eq(studentCheckinPhones.studentId, studentId));
  await db.delete(students).where(eq(students.id, studentId));
  const [gradeRow] = await db.select({ id: gradeLevels.id }).from(gradeLevels).where(eq(gradeLevels.name, gradeName));
  if (gradeRow) {
    await db.delete(gradeLevels).where(eq(gradeLevels.id, gradeRow.id));
  }
});
