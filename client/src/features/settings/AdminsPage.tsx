import { type FormEvent, useEffect, useState } from 'react';
import { ApiRequestError, apiGet, apiPatch, apiPost } from '../../lib/apiClient';

interface Role {
  id: string;
  name: string;
}

interface Admin {
  id: string;
  email: string;
  name: string;
  roleId: string;
  status: 'active' | 'inactive' | 'locked';
  updatedAt: string;
}

const STATUS_LABELS: Record<Admin['status'], string> = {
  active: '활성',
  inactive: '비활성',
  locked: '잠김',
};

export function AdminsPage() {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [adminList, roleList] = await Promise.all([apiGet<Admin[]>('/api/admins'), apiGet<Role[]>('/api/roles')]);
    setAdmins(adminList);
    setRoles(roleList);
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
      await apiPost('/api/admins', { email, name, password, roleId });
      setEmail('');
      setName('');
      setPassword('');
      setRoleId('');
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '관리자를 등록하지 못했습니다.');
    }
  }

  async function handleRoleChange(admin: Admin, nextRoleId: string) {
    setError(null);
    try {
      await apiPatch(`/api/admins/${admin.id}`, { roleId: nextRoleId, expectedUpdatedAt: admin.updatedAt });
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '역할을 변경하지 못했습니다.');
    }
  }

  async function handleDeactivate(admin: Admin) {
    if (!window.confirm(`${admin.name} 관리자를 비활성화할까요?`)) return;
    setError(null);
    try {
      await apiPost(`/api/admins/${admin.id}/deactivate`, {});
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '비활성화하지 못했습니다.');
    }
  }

  async function handleSendReset(admin: Admin) {
    setError(null);
    try {
      await apiPost(`/api/admins/${admin.id}/send-reset`, {});
      window.alert('비밀번호 재설정 메일을 보냈습니다.');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '메일을 보내지 못했습니다.');
    }
  }

  function roleName(id: string) {
    return roles.find((r) => r.id === id)?.name ?? id;
  }

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">관리자 계정</h1>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {admins.map((admin) => (
          <li key={admin.id} className="rounded border border-gray-200 p-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium">{admin.name}</span>
                <span className="ml-2 text-sm text-gray-500">{admin.email}</span>
                <span className="ml-2 text-sm text-gray-500">{STATUS_LABELS[admin.status]}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <select value={admin.roleId} onChange={(event) => handleRoleChange(admin, event.target.value)} className="rounded border border-gray-300 px-2 py-1">
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => handleSendReset(admin)} className="text-blue-600 underline">
                  재설정 메일
                </button>
                {admin.status === 'active' && (
                  <button type="button" onClick={() => handleDeactivate(admin)} className="text-red-600 underline">
                    비활성화
                  </button>
                )}
              </div>
            </div>
            <p className="mt-1 text-sm text-gray-500">현재 역할: {roleName(admin.roleId)}</p>
          </li>
        ))}
      </ul>

      <form onSubmit={handleCreate} className="mt-6 flex flex-col gap-3 rounded border border-gray-200 p-4">
        <h2 className="text-lg font-medium">새 관리자 등록</h2>
        <label className="flex flex-col gap-1">
          <span>이메일</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required className="rounded border border-gray-300 px-3 py-2 text-base" />
        </label>
        <label className="flex flex-col gap-1">
          <span>이름</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required className="rounded border border-gray-300 px-3 py-2 text-base" />
        </label>
        <label className="flex flex-col gap-1">
          <span>초기 비밀번호</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} className="rounded border border-gray-300 px-3 py-2 text-base" />
        </label>
        <label className="flex flex-col gap-1">
          <span>역할</span>
          <select value={roleId} onChange={(event) => setRoleId(event.target.value)} required className="rounded border border-gray-300 px-3 py-2 text-base">
            <option value="">선택</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="self-start rounded bg-blue-600 px-4 py-2 text-white">
          등록
        </button>
      </form>
    </section>
  );
}
