import { type ChangeEvent, type FormEvent, useEffect, useState } from 'react';
import { useParams } from 'wouter';
import { ApiRequestError, apiGet, apiPatch, apiPost } from '../../lib/apiClient';
import { uploadFileDirect } from '../../lib/upload';

interface Draft {
  id: string;
  name: string;
  status: string;
  recipientType: 'all' | 'grade' | 'course' | 'individual';
  filterSnapshot: { gradeLevelId?: string; courseId?: string; studentIds?: string[] };
  duplicateStrategy: 'merge' | 'separate';
  bodySource: string;
  updatedAt: string;
  media: { id: string; mediaId: string }[];
}

interface GradeLevel {
  id: string;
  name: string;
}

interface Course {
  id: string;
  name: string;
}

interface Template {
  id: string;
  name: string;
  body: string;
}

interface Device {
  id: string;
  nickname: string;
  isEnabled: boolean;
}

interface PreviewResult {
  totalCandidates: number;
  includedCount: number;
  excludedCount: number;
  optOutCount: number;
  sample: { phoneNormalized: string; studentNames: string[]; status: string }[];
}

interface ValidateResult {
  includedCount: number;
  optOutCount: number;
  estimatedSendItems: number;
  readyToApprove: boolean;
}

export function MessageDraftDetailPage() {
  const params = useParams<{ draftId: string }>();
  const draftId = params.draftId;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [gradeLevels, setGradeLevels] = useState<GradeLevel[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [recipientType, setRecipientType] = useState<Draft['recipientType']>('all');
  const [gradeLevelId, setGradeLevelId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [duplicateStrategy, setDuplicateStrategy] = useState<Draft['duplicateStrategy']>('merge');
  const [bodySource, setBodySource] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [renderSample, setRenderSample] = useState<{ renderedBody: string; messageKind: string } | null>(null);
  const [validation, setValidation] = useState<ValidateResult | null>(null);
  const [sendMode, setSendMode] = useState<'immediate' | 'scheduled'>('immediate');
  const [scheduledAt, setScheduledAt] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [confirmOptOutOverride, setConfirmOptOutOverride] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function load() {
    if (!draftId) return;
    const [data, grades, courseList, templateList, deviceList] = await Promise.all([
      apiGet<Draft>(`/api/message-drafts/${draftId}`),
      apiGet<GradeLevel[]>('/api/grade-levels'),
      apiGet<Course[]>('/api/courses'),
      apiGet<Template[]>('/api/message-templates'),
      apiGet<Device[]>('/api/messaging/devices').catch(() => []),
    ]);
    setDraft(data);
    setRecipientType(data.recipientType);
    setGradeLevelId(data.filterSnapshot.gradeLevelId ?? '');
    setCourseId(data.filterSnapshot.courseId ?? '');
    setDuplicateStrategy(data.duplicateStrategy);
    setBodySource(data.bodySource);
    setGradeLevels(grades);
    setCourses(courseList);
    setTemplates(templateList);
    setDevices(deviceList);
  }

  useEffect(() => {
    async function loadOnMount() {
      try {
        await load();
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : '불러오지 못했습니다.');
      }
    }
    void loadOnMount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  async function handleSaveRecipients(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiPatch(`/api/message-drafts/${draftId}/recipients`, {
        recipientType,
        filter: { gradeLevelId: gradeLevelId || undefined, courseId: courseId || undefined },
        duplicateStrategy,
      });
      setPreview(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '저장하지 못했습니다.');
    }
  }

  async function handlePreview() {
    setError(null);
    try {
      setPreview(await apiPost<PreviewResult>(`/api/message-drafts/${draftId}/recipient-preview`, {}));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '미리보기에 실패했습니다.');
    }
  }

  async function handleSaveContent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiPatch(`/api/message-drafts/${draftId}/content`, { bodySource, mediaIds: draft?.media.map((m) => m.mediaId) ?? [] });
      setRenderSample(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '저장하지 못했습니다.');
    }
  }

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !draftId) return;
    setError(null);
    setUploading(true);
    try {
      const media = await uploadFileDirect(file, { purpose: 'message_campaign', targetType: 'messageCampaign', targetId: draftId });
      const mediaIds = [...(draft?.media.map((m) => m.mediaId) ?? []), media.id];
      await apiPatch(`/api/message-drafts/${draftId}/content`, { bodySource, mediaIds });
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError || err instanceof Error ? err.message : '사진을 업로드하지 못했습니다.');
    } finally {
      setUploading(false);
    }
  }

  async function handleRenderPreview() {
    setError(null);
    try {
      setRenderSample(await apiPost(`/api/message-drafts/${draftId}/render-preview`, {}));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '미리보기에 실패했습니다.');
    }
  }

  async function handleValidate() {
    setError(null);
    try {
      setValidation(await apiPost<ValidateResult>(`/api/message-drafts/${draftId}/validate`, {}));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '검증에 실패했습니다.');
    }
  }

  async function handleApprove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiPost(`/api/message-drafts/${draftId}/approve`, {
        sendMode,
        scheduledAt: sendMode === 'scheduled' ? new Date(scheduledAt).toISOString() : undefined,
        deviceId,
        confirmOptOutOverride,
      });
      await load();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'OPT_OUT_RECIPIENTS') {
        setError(`${err.message} 아래 "수신거부자가 있어도 발송" 체크 후 다시 승인해 주세요.`);
        return;
      }
      setError(err instanceof ApiRequestError ? err.message : '승인하지 못했습니다.');
    }
  }

  if (!draft) {
    return <section className="p-4">{error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-gray-500">불러오는 중...</p>}</section>;
  }

  const isDraftEditable = draft.status === 'draft';

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">{draft.name}</h1>
      <p className="mt-1 text-sm text-gray-500">상태: {draft.status}</p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <form onSubmit={handleSaveRecipients} className="mt-4 flex flex-col gap-3 rounded border border-gray-200 p-4">
        <h2 className="font-medium">1. 수신자 조건</h2>
        <label className="flex flex-col gap-1">
          <span>대상</span>
          <select value={recipientType} onChange={(event) => setRecipientType(event.target.value as Draft['recipientType'])} className="rounded border border-gray-300 px-3 py-2 text-base">
            <option value="all">전체 재원생</option>
            <option value="grade">학년별</option>
            <option value="course">강좌별</option>
          </select>
        </label>
        {recipientType === 'grade' && (
          <label className="flex flex-col gap-1">
            <span>학년</span>
            <select value={gradeLevelId} onChange={(event) => setGradeLevelId(event.target.value)} className="rounded border border-gray-300 px-3 py-2 text-base">
              <option value="">선택</option>
              {gradeLevels.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {recipientType === 'course' && (
          <label className="flex flex-col gap-1">
            <span>강좌</span>
            <select value={courseId} onChange={(event) => setCourseId(event.target.value)} className="rounded border border-gray-300 px-3 py-2 text-base">
              <option value="">선택</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span>같은 번호로 형제자매가 연결된 경우</span>
          <select value={duplicateStrategy} onChange={(event) => setDuplicateStrategy(event.target.value as Draft['duplicateStrategy'])} className="rounded border border-gray-300 px-3 py-2 text-base">
            <option value="merge">한 번만 보내기 (이름 함께 표시)</option>
            <option value="separate">학생별로 각각 보내기</option>
          </select>
        </label>
        <button type="submit" className="self-start rounded bg-gray-200 px-4 py-2">
          저장
        </button>
      </form>

      <div className="mt-4 rounded border border-gray-200 p-4">
        <button type="button" onClick={handlePreview} className="rounded bg-gray-200 px-4 py-2">
          수신자 미리보기
        </button>
        {preview && (
          <p className="mt-2 text-sm">
            전체 {preview.totalCandidates}명 중 발송대상 {preview.includedCount}명, 제외 {preview.excludedCount}명 (수신거부 {preview.optOutCount}명)
          </p>
        )}
      </div>

      <form onSubmit={handleSaveContent} className="mt-4 flex flex-col gap-3 rounded border border-gray-200 p-4">
        <h2 className="font-medium">2. 문자 내용</h2>
        {templates.length > 0 && (
          <label className="flex flex-col gap-1">
            <span>템플릿 불러오기</span>
            <select onChange={(event) => setBodySource(templates.find((t) => t.id === event.target.value)?.body ?? bodySource)} className="rounded border border-gray-300 px-3 py-2 text-base">
              <option value="">직접 작성</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span>본문 ({'{{이름}}'} 사용 가능)</span>
          <textarea value={bodySource} onChange={(event) => setBodySource(event.target.value)} rows={5} className="rounded border border-gray-300 px-3 py-2 text-base" />
        </label>
        <div className="flex items-center gap-3">
          <button type="submit" className="rounded bg-gray-200 px-4 py-2">
            저장
          </button>
          <label className="cursor-pointer rounded bg-gray-100 px-3 py-2 text-sm">
            {uploading ? '업로드 중...' : `사진 첨부 (${draft.media.length}장)`}
            <input type="file" accept="image/*" onChange={handleFileSelected} disabled={uploading} className="hidden" />
          </label>
        </div>
      </form>

      <div className="mt-4 rounded border border-gray-200 p-4">
        <button type="button" onClick={handleRenderPreview} className="rounded bg-gray-200 px-4 py-2">
          발송 미리보기
        </button>
        {renderSample && (
          <div className="mt-2 rounded bg-gray-50 p-3 text-sm">
            <p className="whitespace-pre-wrap">{renderSample.renderedBody}</p>
            <p className="mt-1 text-gray-500">분류: {renderSample.messageKind}</p>
          </div>
        )}
      </div>

      <div className="mt-4 rounded border border-gray-200 p-4">
        <button type="button" onClick={handleValidate} className="rounded bg-gray-200 px-4 py-2">
          최종 검증
        </button>
        {validation && (
          <p className="mt-2 text-sm">
            발송대상 {validation.includedCount}명, 예상 발송건수 {validation.estimatedSendItems}건, 수신거부 {validation.optOutCount}명 —{' '}
            {validation.readyToApprove ? '승인 가능' : '내용을 확인해 주세요'}
          </p>
        )}
      </div>

      {isDraftEditable && (
        <form onSubmit={handleApprove} className="mt-4 flex flex-col gap-3 rounded border border-gray-200 p-4">
          <h2 className="font-medium">3. 승인</h2>
          <label className="flex flex-col gap-1">
            <span>발송 기기</span>
            <select value={deviceId} onChange={(event) => setDeviceId(event.target.value)} required className="rounded border border-gray-300 px-3 py-2 text-base">
              <option value="">선택</option>
              {devices
                .filter((d) => d.isEnabled)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nickname}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span>발송 방식</span>
            <select value={sendMode} onChange={(event) => setSendMode(event.target.value as 'immediate' | 'scheduled')} className="rounded border border-gray-300 px-3 py-2 text-base">
              <option value="immediate">즉시발송</option>
              <option value="scheduled">예약발송</option>
            </select>
          </label>
          {sendMode === 'scheduled' && (
            <label className="flex flex-col gap-1">
              <span>예약시각</span>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
                required
                className="rounded border border-gray-300 px-3 py-2 text-base"
              />
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={confirmOptOutOverride} onChange={(event) => setConfirmOptOutOverride(event.target.checked)} />
            <span>수신거부자가 있어도 발송 (확인했습니다)</span>
          </label>
          <button type="submit" className="self-start rounded bg-blue-600 px-4 py-2 text-white">
            승인
          </button>
        </form>
      )}
    </section>
  );
}
