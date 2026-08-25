import { type ReactNode, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { apiPost } from '../../lib/apiClient';
import type { AuthenticatedAdmin } from '../../hooks/useAuth';
import { ADMIN_NAV_GROUPS } from './adminNav';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';

interface AdminLayoutProps {
  admin: AuthenticatedAdmin;
  children: ReactNode;
}

export function AdminLayout({ admin, children }: AdminLayoutProps) {
  const [location, navigate] = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function handleLogout() {
    await apiPost('/api/auth/logout', {});
    navigate('/login');
  }

  const hasPermission = admin.role.permissions.includes(SUPER_ADMIN_WILDCARD_PERMISSION)
    ? () => true
    : (permission: string) => admin.role.permissions.includes(permission);

  const visibleNavGroups = ADMIN_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => hasPermission(item.permission)),
  })).filter((group) => group.items.length > 0);

  const sidebarContent = (
    <nav className="flex h-full flex-col overflow-y-auto px-3 py-4">
      <Link
        href="/admin"
        onClick={() => setDrawerOpen(false)}
        className="mb-4 block rounded-lg px-3 py-2 text-base font-semibold text-white"
      >
        학원 업무자동화
      </Link>
      <ul className="space-y-1">
        <li>
          <Link
            href="/admin"
            onClick={() => setDrawerOpen(false)}
            className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              location === '/admin'
                ? 'bg-slate-700 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            대시보드
          </Link>
        </li>
      </ul>
      {visibleNavGroups.map((group) => (
        <div key={group.title} className="mt-5">
          <p className="px-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.title}</p>
          <ul className="mt-1 space-y-1">
            {group.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setDrawerOpen(false)}
                  className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    location === item.href
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-gray-50 lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 bg-slate-900 lg:block">{sidebarContent}</aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 w-64 bg-slate-900 shadow-xl">{sidebarContent}</aside>
        </div>
      )}

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 lg:hidden"
            aria-label="메뉴 열기"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-6 w-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-sm font-medium text-gray-500 lg:hidden">학원 업무자동화</span>
          <div className="ml-auto flex items-center gap-3">
            <Link href="/admin/profile" className="text-sm text-gray-700 hover:underline">
              <span className="font-medium">{admin.name}</span>
              <span className="ml-1 text-gray-400">({admin.role.name})</span>
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
            >
              로그아웃
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
