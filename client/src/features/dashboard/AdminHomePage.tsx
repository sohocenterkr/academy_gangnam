import { Link } from 'wouter';
import { useAuth } from '../../hooks/useAuth';

export function AdminHomePage() {
  const { admin, loading } = useAuth();

  if (loading) return <p className="p-4 text-gray-500">불러오는 중...</p>;
  if (!admin) return null;

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">{admin.name}님, 안녕하세요</h1>
      <p className="mt-2 text-gray-600">학원 업무자동화 관리자 화면입니다.</p>
      <nav className="mt-6">
        <ul className="space-y-2">
          <li>
            <Link href="/admin/settings/academy" className="text-blue-600 underline">
              학원 기본정보
            </Link>
          </li>
          <li>
            <Link href="/admin/settings/academics" className="text-blue-600 underline">
              학교·학년 기준정보
            </Link>
          </li>
          <li>
            <Link href="/admin/guardians" className="text-blue-600 underline">
              보호자 관리
            </Link>
          </li>
          <li>
            <Link href="/admin/students" className="text-blue-600 underline">
              학생 관리
            </Link>
          </li>
          <li>
            <Link href="/admin/check-ins" className="text-blue-600 underline">
              등원 조회
            </Link>
          </li>
          <li>
            <Link href="/admin/instructors" className="text-blue-600 underline">
              강사 관리
            </Link>
          </li>
          <li>
            <Link href="/admin/courses" className="text-blue-600 underline">
              강좌 관리
            </Link>
          </li>
          <li>
            <Link href="/admin/profile" className="text-blue-600 underline">
              내 계정
            </Link>
          </li>
        </ul>
      </nav>
    </section>
  );
}
