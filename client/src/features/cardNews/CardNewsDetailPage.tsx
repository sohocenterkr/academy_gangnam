import { type ChangeEvent, type FormEvent, useEffect, useState } from 'react';
import { useParams } from 'wouter';
import { ApiRequestError, apiDelete, apiGet, apiPatch, apiPost, apiPut } from '../../lib/apiClient';
import { uploadFileDirect } from '../../lib/upload';

interface MediaLink {
  id: string;
  mediaId: string;
  role: string;
  sortOrder: number;
  secureUrl: string;
  resourceType: string;
}

interface Card {
  id: string;
  title: string | null;
  body: string | null;
  sortOrder: number;
}

interface ProjectDetail {
  id: string;
  name: string;
  title: string | null;
  story: string | null;
  status: string;
  sendPhotosToAi: boolean;
  privacyConfirmedAt: string | null;
  expiresAt: string;
  updatedAt: string;
  media: MediaLink[];
  cards: Card[];
}

export function CardNewsDetailPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [title, setTitle] = useState('');
  const [story, setStory] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [cardDrafts, setCardDrafts] = useState<Array<{ title: string; body: string }>>([]);
  const [generating, setGenerating] = useState(false);

  async function load() {
    if (!projectId) return;
    const data = await apiGet<ProjectDetail>(`/api/card-news/${projectId}`);
    setProject(data);
    setTitle(data.title ?? '');
    setStory(data.story ?? '');
    setCardDrafts(data.cards.map((c) => ({ title: c.title ?? '', body: c.body ?? '' })));
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
  }, [projectId]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project) return;
    setError(null);
    try {
      await apiPatch(`/api/card-news/${projectId}`, { title, story, expectedUpdatedAt: project.updatedAt });
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '저장하지 못했습니다.');
    }
  }

  async function handleToggleAi() {
    if (!project) return;
    setError(null);
    try {
      if (project.sendPhotosToAi) {
        await apiPatch(`/api/card-news/${projectId}`, { sendPhotosToAi: false, expectedUpdatedAt: project.updatedAt });
      } else {
        if (!window.confirm('사진에 개인정보(얼굴, 이름표 등)가 없는지 확인했나요? AI 공급자에게 사진이 전달됩니다.')) return;
        await apiPatch(`/api/card-news/${projectId}`, { sendPhotosToAi: true, privacyConfirmed: true, expectedUpdatedAt: project.updatedAt });
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '설정을 변경하지 못했습니다.');
    }
  }

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !projectId) return;
    setError(null);
    setUploading(true);
    try {
      const media = await uploadFileDirect(file, { purpose: 'card_news', targetType: 'cardNewsProject', targetId: projectId });
      await apiPost(`/api/card-news/${projectId}/media`, { mediaId: media.id, role: 'source' });
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError || err instanceof Error ? err.message : '사진을 업로드하지 못했습니다.');
    } finally {
      setUploading(false);
    }
  }

  async function handleRemoveMedia(mediaId: string) {
    if (!projectId) return;
    setError(null);
    try {
      await apiDelete(`/api/card-news/${projectId}/media/${mediaId}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '사진을 제거하지 못했습니다.');
    }
  }

  async function handleGenerate() {
    if (!projectId) return;
    setError(null);
    try {
      const cardCount = 3;
      const estimate = await apiPost<{ estimatedCostUsd: number }>(`/api/card-news/${projectId}/cost-estimate`, { cardCount });
      if (!window.confirm(`AI로 카드 ${cardCount}장을 생성합니다. 예상 비용은 약 $${estimate.estimatedCostUsd.toFixed(4)}입니다. 계속할까요?`)) return;
      setGenerating(true);
      await apiPost(`/api/card-news/${projectId}/generate`, { cardCount });
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'AI 생성에 실패했습니다.');
    } finally {
      setGenerating(false);
    }
  }

  function updateCardDraft(index: number, field: 'title' | 'body', value: string) {
    setCardDrafts((prev) => prev.map((card, i) => (i === index ? { ...card, [field]: value } : card)));
  }

  async function handleSaveCards() {
    if (!projectId) return;
    setError(null);
    try {
      await apiPut(`/api/card-news/${projectId}/cards`, { cards: cardDrafts });
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '카드 내용을 저장하지 못했습니다.');
    }
  }

  if (!project) {
    return <section className="p-4">{error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-gray-500">불러오는 중...</p>}</section>;
  }

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">{project.name}</h1>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
      <p className="mt-1 text-sm text-gray-500">
        {project.expiresAt} 까지 보관 후 정리됩니다.
      </p>

      <form onSubmit={handleSave} className="mt-4 flex flex-col gap-3 rounded border border-gray-200 p-4">
        <label className="flex flex-col gap-1">
          <span>제목</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} className="rounded border border-gray-300 px-3 py-2 text-base" />
        </label>
        <label className="flex flex-col gap-1">
          <span>사연</span>
          <textarea value={story} onChange={(event) => setStory(event.target.value)} rows={4} className="rounded border border-gray-300 px-3 py-2 text-base" />
        </label>
        <button type="submit" className="self-start rounded bg-blue-600 px-4 py-2 text-white">
          저장
        </button>
      </form>

      <div className="mt-4 rounded border border-gray-200 p-4">
        <h2 className="font-medium">AI 사진 전달</h2>
        <label className="mt-2 flex items-center gap-2">
          <input type="checkbox" checked={project.sendPhotosToAi} onChange={handleToggleAi} />
          <span>사진을 AI 공급자에게 전달해 문구·구성을 생성합니다</span>
        </label>
        {project.sendPhotosToAi && project.privacyConfirmedAt && (
          <p className="mt-1 text-sm text-gray-500">개인정보 확인됨 ({project.privacyConfirmedAt})</p>
        )}
      </div>

      <div className="mt-4 rounded border border-gray-200 p-4">
        <h2 className="font-medium">사진</h2>
        <div className="mt-2 flex flex-wrap gap-3">
          {project.media.map((item) => (
            <div key={item.id} className="w-32">
              {item.resourceType === 'image' ? (
                <img src={item.secureUrl} alt="" className="h-32 w-32 rounded object-cover" />
              ) : (
                <div className="flex h-32 w-32 items-center justify-center rounded bg-gray-100 text-sm text-gray-500">{item.resourceType}</div>
              )}
              <button type="button" onClick={() => handleRemoveMedia(item.mediaId)} className="mt-1 text-sm text-red-600 underline">
                제거
              </button>
            </div>
          ))}
        </div>
        <label className="mt-3 inline-block cursor-pointer rounded bg-gray-200 px-4 py-2 text-sm">
          {uploading ? '업로드 중...' : '사진 추가'}
          <input type="file" accept="image/*" onChange={handleFileSelected} disabled={uploading} className="hidden" />
        </label>
      </div>

      <div className="mt-4 rounded border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">카드 문구 (AI 생성)</h2>
          <button type="button" onClick={handleGenerate} disabled={generating} className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">
            {generating ? '생성 중...' : 'AI로 생성'}
          </button>
        </div>

        {cardDrafts.length > 0 && (
          <div className="mt-3 space-y-3">
            {cardDrafts.map((card, index) => (
              <div key={index} className="rounded border border-gray-200 p-2">
                <input
                  value={card.title}
                  onChange={(event) => updateCardDraft(index, 'title', event.target.value)}
                  placeholder="카드 제목"
                  className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                />
                <textarea
                  value={card.body}
                  onChange={(event) => updateCardDraft(index, 'body', event.target.value)}
                  placeholder="카드 본문"
                  rows={2}
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </div>
            ))}
            <button type="button" onClick={handleSaveCards} className="rounded bg-gray-200 px-4 py-2 text-sm">
              카드 내용 저장
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
