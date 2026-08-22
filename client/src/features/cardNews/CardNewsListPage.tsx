import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ApiRequestError, apiGet, apiPost } from '../../lib/apiClient';

interface Project {
  id: string;
  name: string;
  status: string;
  expiresAt: string;
  updatedAt: string;
}

interface Preset {
  id: string;
  name: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft: '초안',
  uploading: '업로드 중',
  generating: '생성 중',
  editing: '편집 중',
  rendering: '렌더링 중',
  ready: '완료',
  partial_error: '일부 오류',
  expired: '만료됨',
  deleted: '삭제됨',
};

export function CardNewsListPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [name, setName] = useState('');
  const [presetId, setPresetId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadOnMount() {
      try {
        const [projectList, presetList] = await Promise.all([apiGet<Project[]>('/api/card-news'), apiGet<Preset[]>('/api/platform-presets')]);
        setProjects(projectList);
        setPresets(presetList);
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : '불러오지 못했습니다.');
      }
    }
    void loadOnMount();
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const created = await apiPost<Project>('/api/card-news', { name, presetId });
      setProjects((prev) => [created, ...prev]);
      setName('');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '프로젝트를 만들지 못했습니다.');
    }
  }

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">카드뉴스</h1>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {projects.map((project) => (
          <li key={project.id} className="rounded border border-gray-200 p-3">
            <Link href={`/admin/card-news/${project.id}`} className="text-blue-600 underline">
              {project.name}
            </Link>
            <span className="ml-2 text-sm text-gray-500">{STATUS_LABELS[project.status] ?? project.status}</span>
          </li>
        ))}
      </ul>

      <form onSubmit={handleCreate} className="mt-6 flex flex-col gap-3 rounded border border-gray-200 p-4">
        <h2 className="text-lg font-medium">새 카드뉴스 만들기</h2>
        <label className="flex flex-col gap-1">
          <span>이름</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required className="rounded border border-gray-300 px-3 py-2 text-base" />
        </label>
        <label className="flex flex-col gap-1">
          <span>플랫폼 프리셋</span>
          <select
            value={presetId}
            onChange={(event) => setPresetId(event.target.value)}
            required
            className="rounded border border-gray-300 px-3 py-2 text-base"
          >
            <option value="">선택</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="self-start rounded bg-blue-600 px-4 py-2 text-white">
          만들기
        </button>
      </form>
    </section>
  );
}
