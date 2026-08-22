import { useState } from 'react';
import { ApiRequestError, apiGet, apiPost } from '../../lib/apiClient';

type ReportType = 'check-ins' | 'students' | 'courses' | 'messages' | 'card-news';

const REPORT_LABELS: Record<ReportType, string> = {
  'check-ins': '등원 통계',
  students: '학생·학년 통계',
  courses: '강좌·수강 통계',
  messages: '문자 발송 통계',
  'card-news': '카드뉴스 통계',
};

export function ReportsPage() {
  const [reportType, setReportType] = useState<ReportType>('check-ins');
  const [data, setData] = useState<unknown>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  async function handleLoad() {
    setError(null);
    setDownloadUrl(null);
    try {
      setData(await apiGet(`/api/reports/${reportType}`));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '불러오지 못했습니다.');
    }
  }

  async function handleExport() {
    setError(null);
    setExporting(true);
    try {
      const result = await apiPost<{ downloadUrl: string }>('/api/exports', { reportType });
      setDownloadUrl(result.downloadUrl);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '엑셀 생성에 실패했습니다.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">보고서</h1>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span>보고서 종류</span>
          <select value={reportType} onChange={(event) => setReportType(event.target.value as ReportType)} className="rounded border border-gray-300 px-3 py-2 text-base">
            {Object.entries(REPORT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={handleLoad} className="rounded bg-gray-200 px-4 py-2">
          조회
        </button>
        <button type="button" onClick={handleExport} disabled={exporting} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
          {exporting ? '생성 중...' : '엑셀로 내보내기'}
        </button>
        {downloadUrl && (
          <a href={downloadUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline">
            다운로드
          </a>
        )}
      </div>

      {data !== null && (
        <pre className="mt-4 overflow-x-auto rounded border border-gray-200 bg-gray-50 p-3 text-xs">{JSON.stringify(data, null, 2)}</pre>
      )}
    </section>
  );
}
