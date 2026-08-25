export interface AdminNavItem {
  href: string;
  label: string;
}

export interface AdminNavGroup {
  title: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    title: '학생·보호자',
    items: [
      { href: '/admin/guardians', label: '보호자 관리' },
      { href: '/admin/students', label: '학생 관리' },
    ],
  },
  {
    title: '등원',
    items: [{ href: '/admin/check-ins', label: '등원 조회' }],
  },
  {
    title: '강좌',
    items: [
      { href: '/admin/instructors', label: '강사 관리' },
      { href: '/admin/courses', label: '강좌 관리' },
    ],
  },
  {
    title: '문자 발송',
    items: [
      { href: '/admin/messaging/settings', label: '문자 발송 설정' },
      { href: '/admin/messaging/templates', label: '문자 템플릿' },
      { href: '/admin/messaging/drafts', label: '문자 발송' },
      { href: '/admin/messaging/campaigns', label: '문자 발송 현황' },
    ],
  },
  {
    title: '카드뉴스',
    items: [
      { href: '/admin/card-news', label: '카드뉴스' },
      { href: '/admin/card-news/presets', label: '카드뉴스 플랫폼 프리셋' },
    ],
  },
  {
    title: '설정·관리',
    items: [
      { href: '/admin/settings/academy', label: '학원 기본정보' },
      { href: '/admin/settings/academics', label: '학교·학년 기준정보' },
      { href: '/admin/settings/admins', label: '관리자 계정' },
      { href: '/admin/settings/roles', label: '역할·권한 관리' },
      { href: '/admin/reports', label: '보고서' },
      { href: '/admin/audit-logs', label: '감사 로그' },
    ],
  },
];
