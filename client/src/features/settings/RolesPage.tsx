import { type FormEvent, useEffect, useState } from 'react';
import { ApiRequestError, apiGet, apiPatch, apiPost } from '../../lib/apiClient';
import { PERMISSIONS, SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';

interface Role {
  id: string;
  name: string;
  permissions: string[];
  isSystem: boolean;
  updatedAt: string;
}

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

export function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [name, setName] = useState('');
  const [permissions, setPermissions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setRoles(await apiGet<Role[]>('/api/roles'));
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

  function togglePermission(list: string[], setList: (next: string[]) => void, permission: string) {
    setList(list.includes(permission) ? list.filter((p) => p !== permission) : [...list, permission]);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiPost('/api/roles', { name, permissions });
      setName('');
      setPermissions([]);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '역할을 만들지 못했습니다.');
    }
  }

  async function handleTogglePermission(role: Role, permission: string) {
    setError(null);
    const nextPermissions = role.permissions.includes(permission)
      ? role.permissions.filter((p) => p !== permission)
      : [...role.permissions, permission];
    try {
      await apiPatch(`/api/roles/${role.id}`, { permissions: nextPermissions, expectedUpdatedAt: role.updatedAt });
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '권한을 변경하지 못했습니다.');
    }
  }

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">역할·권한 관리</h1>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="mt-4 space-y-4">
        {roles.map((role) => (
          <div key={role.id} className="rounded border border-gray-200 p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">{role.name}</span>
              {role.isSystem && <span className="text-xs text-gray-500">시스템 역할 (수정 불가)</span>}
            </div>
            {role.permissions.includes(SUPER_ADMIN_WILDCARD_PERMISSION) ? (
              <p className="mt-2 text-sm text-gray-500">모든 권한 (최고관리자)</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-3 text-sm">
                {ALL_PERMISSIONS.map((permission) => (
                  <label key={permission} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={role.permissions.includes(permission)}
                      disabled={role.isSystem}
                      onChange={() => handleTogglePermission(role, permission)}
                    />
                    {permission}
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={handleCreate} className="mt-6 flex flex-col gap-3 rounded border border-gray-200 p-4">
        <h2 className="text-lg font-medium">새 역할 만들기</h2>
        <label className="flex flex-col gap-1">
          <span>이름</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required className="rounded border border-gray-300 px-3 py-2 text-base" />
        </label>
        <div className="flex flex-wrap gap-3 text-sm">
          {ALL_PERMISSIONS.map((permission) => (
            <label key={permission} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={permissions.includes(permission)}
                onChange={() => togglePermission(permissions, setPermissions, permission)}
              />
              {permission}
            </label>
          ))}
        </div>
        <button type="submit" className="self-start rounded bg-blue-600 px-4 py-2 text-white">
          역할 등록
        </button>
      </form>
    </section>
  );
}
