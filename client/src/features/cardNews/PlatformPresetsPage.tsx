import { type FormEvent, useEffect, useState } from 'react';
import { ApiRequestError, apiDelete, apiGet, apiPost } from '../../lib/apiClient';

interface Preset {
  id: string;
  platform: string;
  postType: string;
  name: string;
  widthPx: number;
  heightPx: number;
  isActive: boolean;
}

export function PlatformPresetsPage() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [platform, setPlatform] = useState('instagram');
  const [postType, setPostType] = useState('feed');
  const [name, setName] = useState('');
  const [widthPx, setWidthPx] = useState('1080');
  const [heightPx, setHeightPx] = useState('1080');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setPresets(await apiGet<Preset[]>('/api/platform-presets'));
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
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiPost('/api/platform-presets', {
        platform,
        postType,
        name,
        widthPx: Number(widthPx),
        heightPx: Number(heightPx),
      });
      setName('');
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '등록하지 못했습니다.');
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('이 프리셋을 삭제할까요? 사용 중이면 비활성화됩니다.')) return;
    setError(null);
    try {
      await apiDelete(`/api/platform-presets/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '삭제하지 못했습니다.');
    }
  }

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">카드뉴스 플랫폼 프리셋</h1>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {presets.map((preset) => (
          <li key={preset.id} className="flex items-center justify-between rounded border border-gray-200 p-3">
            <div>
              <span className="font-medium">{preset.name}</span>
              <span className="ml-2 text-sm text-gray-500">
                {preset.platform} · {preset.postType} · {preset.widthPx}×{preset.heightPx}
              </span>
            </div>
            <button type="button" onClick={() => handleDelete(preset.id)} className="text-sm text-red-600 underline">
              삭제
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={handleCreate} className="mt-6 flex flex-col gap-3 rounded border border-gray-200 p-4">
        <h2 className="text-lg font-medium">새 프리셋 등록</h2>
        <label className="flex flex-col gap-1">
          <span>플랫폼</span>
          <input value={platform} onChange={(event) => setPlatform(event.target.value)} required className="rounded border border-gray-300 px-3 py-2 text-base" />
        </label>
        <label className="flex flex-col gap-1">
          <span>게시 유형</span>
          <input value={postType} onChange={(event) => setPostType(event.target.value)} required className="rounded border border-gray-300 px-3 py-2 text-base" />
        </label>
        <label className="flex flex-col gap-1">
          <span>이름</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required className="rounded border border-gray-300 px-3 py-2 text-base" />
        </label>
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span>가로(px)</span>
            <input
              value={widthPx}
              onChange={(event) => setWidthPx(event.target.value)}
              type="number"
              required
              className="rounded border border-gray-300 px-3 py-2 text-base"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span>세로(px)</span>
            <input
              value={heightPx}
              onChange={(event) => setHeightPx(event.target.value)}
              type="number"
              required
              className="rounded border border-gray-300 px-3 py-2 text-base"
            />
          </label>
        </div>
        <button type="submit" className="self-start rounded bg-blue-600 px-4 py-2 text-white">
          프리셋 등록
        </button>
      </form>
    </section>
  );
}
