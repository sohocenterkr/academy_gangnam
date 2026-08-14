import { useLocation } from 'wouter';
import { apiPost } from '../../lib/apiClient';
import { useAuth } from '../../hooks/useAuth';

export function ProfilePage() {
  const { admin, loading } = useAuth();
  const [, navigate] = useLocation();

  async function handleLogout() {
    await apiPost('/api/auth/logout', {});
    navigate('/login');
  }

  if (loading) return <p className="p-4 text-gray-500">불러오는 중...</p>;
  if (!admin) return null;

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">내 계정</h1>
      <dl className="mt-4 space-y-2">
        <div>
          <dt className="text-sm text-gray-500">이름</dt>
          <dd>{admin.name}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">이메일</dt>
          <dd>{admin.email}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">역할</dt>
          <dd>{admin.role.name}</dd>
        </div>
      </dl>
      <button onClick={handleLogout} className="mt-6 rounded bg-gray-200 px-4 py-2">
        로그아웃
      </button>
    </section>
  );
}
