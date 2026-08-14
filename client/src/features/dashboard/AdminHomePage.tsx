import { useAuth } from '../../hooks/useAuth';

export function AdminHomePage() {
  const { admin, loading } = useAuth();

  if (loading) return <p className="p-4 text-gray-500">불러오는 중...</p>;
  if (!admin) return null;

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">{admin.name}님, 안녕하세요</h1>
      <p className="mt-2 text-gray-600">학원 업무자동화 관리자 화면입니다.</p>
    </section>
  );
}
