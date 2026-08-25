import type { ReactNode } from 'react';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-white text-gray-900" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {children}
    </div>
  );
}
