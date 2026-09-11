import { useEffect, useState } from 'react';
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

  if (loading) return <p className="text-gray-500">불러오는 중...</p>;
  if (!admin) return null;

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{admin.name}님, 안녕하세요</h1>
          <p className="mt-1 text-gray-500">학원 업무자동화 관리자 화면입니다.</p>
        </div>
        <a
          href="/check-in"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          등원 체크인 화면 열기
        </a>
      </div>

      {summary && (
        <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <dt className="text-sm text-gray-500">재원생</dt>
            <dd className="mt-1 text-2xl font-semibold text-gray-900">{summary.activeStudentCount}명</dd>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <dt className="text-sm text-gray-500">오늘 등원</dt>
            <dd className="mt-1 text-2xl font-semibold text-gray-900">{summary.todayCheckInCount}명</dd>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <dt className="text-sm text-gray-500">발송 대기 중</dt>
            <dd className="mt-1 text-2xl font-semibold text-gray-900">{summary.pendingMessageCampaignCount}건</dd>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <dt className="text-sm text-gray-500">오늘 문자 발송</dt>
            <dd className="mt-1 text-2xl font-semibold text-gray-900">
              {summary.todayMessageSendItemCount} / {summary.dailyMessageLimit}건
            </dd>
          </div>
        </dl>
      )}

      <p className="mt-8 text-sm text-gray-400">왼쪽 메뉴에서 원하는 기능을 선택하세요.</p>
    </section>
  );
}
