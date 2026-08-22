import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { useAuth } from '../../hooks/useAuth';
import { apiGet } from '../../lib/apiClient';

interface DashboardSummary {
  activeStudentCount: number;
  activeEnrollmentCount: number;
  todayCheckInCount: number;
  pendingMessageCampaignCount: number;
  todayMessageSendItemCount: number;
  dailyMessageLimit: number;
  activeCardNewsProjectCount: number;
}

export function AdminHomePage() {
  const { admin, loading } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);

  useEffect(() => {
    async function loadSummary() {
      try {
        setSummary(await apiGet<DashboardSummary>('/api/dashboard'));
      } catch {
        // Dashboard summary is a nice-to-have on this page; a fetch failure here
        // shouldn't block the admin from reaching the nav links below.
      }
    }
    void loadSummary();
  }, []);

  if (loading) return <p className="p-4 text-gray-500">불러오는 중...</p>;
  if (!admin) return null;

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">{admin.name}님, 안녕하세요</h1>
      <p className="mt-2 text-gray-600">학원 업무자동화 관리자 화면입니다.</p>

      {summary && (
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded border border-gray-200 p-3">
            <dt className="text-xs text-gray-500">재원생</dt>
            <dd className="text-lg font-semibold">{summary.activeStudentCount}명</dd>
          </div>
          <div className="rounded border border-gray-200 p-3">
            <dt className="text-xs text-gray-500">오늘 등원</dt>
            <dd className="text-lg font-semibold">{summary.todayCheckInCount}명</dd>
          </div>
          <div className="rounded border border-gray-200 p-3">
            <dt className="text-xs text-gray-500">발송 대기 중</dt>
            <dd className="text-lg font-semibold">{summary.pendingMessageCampaignCount}건</dd>
          </div>
          <div className="rounded border border-gray-200 p-3">
            <dt className="text-xs text-gray-500">오늘 문자 발송</dt>
            <dd className="text-lg font-semibold">
              {summary.todayMessageSendItemCount} / {summary.dailyMessageLimit}건
            </dd>
          </div>
        </dl>
      )}

      <nav className="mt-6">
        <ul className="space-y-2">
          <li>
            <Link href="/admin/settings/academy" className="text-blue-600 underline">
              학원 기본정보
            </Link>
          </li>
          <li>
            <Link href="/admin/settings/academics" className="text-blue-600 underline">
              학교·학년 기준정보
            </Link>
          </li>
          <li>
            <Link href="/admin/guardians" className="text-blue-600 underline">
              보호자 관리
            </Link>
          </li>
          <li>
            <Link href="/admin/students" className="text-blue-600 underline">
              학생 관리
            </Link>
          </li>
          <li>
            <Link href="/admin/check-ins" className="text-blue-600 underline">
              등원 조회
            </Link>
          </li>
          <li>
            <Link href="/admin/instructors" className="text-blue-600 underline">
              강사 관리
            </Link>
          </li>
          <li>
            <Link href="/admin/courses" className="text-blue-600 underline">
              강좌 관리
            </Link>
          </li>
          <li>
            <Link href="/admin/messaging/settings" className="text-blue-600 underline">
              문자 발송 설정
            </Link>
          </li>
          <li>
            <Link href="/admin/messaging/templates" className="text-blue-600 underline">
              문자 템플릿
            </Link>
          </li>
          <li>
            <Link href="/admin/messaging/drafts" className="text-blue-600 underline">
              문자 발송
            </Link>
          </li>
          <li>
            <Link href="/admin/messaging/campaigns" className="text-blue-600 underline">
              문자 발송 현황
            </Link>
          </li>
          <li>
            <Link href="/admin/card-news" className="text-blue-600 underline">
              카드뉴스
            </Link>
          </li>
          <li>
            <Link href="/admin/card-news/presets" className="text-blue-600 underline">
              카드뉴스 플랫폼 프리셋
            </Link>
          </li>
          <li>
            <Link href="/admin/audit-logs" className="text-blue-600 underline">
              감사 로그
            </Link>
          </li>
          <li>
            <Link href="/admin/profile" className="text-blue-600 underline">
              내 계정
            </Link>
          </li>
        </ul>
      </nav>
    </section>
  );
}
