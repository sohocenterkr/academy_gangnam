import { PERMISSIONS, type Permission } from '@shared/permissions';

export interface AdminNavItem {
  href: string;
  label: string;
  // Permission required to use this page — matches the server-side check in
  // the corresponding route (see server/routes/*.ts createRequirePermission calls).
  permission: Permission;
}

export interface AdminNavGroup {
  title: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    title: '학생·보호자',
    items: [
      { href: '/admin/guardians', label: '보호자 관리', permission: PERMISSIONS.GUARDIANS_MANAGE },
      { href: '/admin/students', label: '학생 관리', permission: PERMISSIONS.STUDENTS_MANAGE },
    ],
  },
  {
    title: '등원',
    items: [{ href: '/admin/check-ins', label: '등원 조회', permission: PERMISSIONS.CHECKINS_MANAGE }],
  },
  {
    title: '강좌',
    items: [
      { href: '/admin/instructors', label: '강사 관리', permission: PERMISSIONS.COURSES_MANAGE },
      { href: '/admin/courses', label: '강좌 관리', permission: PERMISSIONS.COURSES_MANAGE },
    ],
  },
  {
    title: '문자 발송',
    items: [
      { href: '/admin/messaging/settings', label: '문자 발송 설정', permission: PERMISSIONS.MESSAGING_MANAGE },
      { href: '/admin/messaging/templates', label: '문자 템플릿', permission: PERMISSIONS.MESSAGING_MANAGE },
      { href: '/admin/messaging/drafts', label: '문자 발송', permission: PERMISSIONS.MESSAGING_MANAGE },
      { href: '/admin/messaging/campaigns', label: '문자 발송 현황', permission: PERMISSIONS.MESSAGING_MANAGE },
    ],
  },
  {
    title: '카드뉴스',
    items: [
      { href: '/admin/card-news', label: '카드뉴스', permission: PERMISSIONS.CARD_NEWS_MANAGE },
      { href: '/admin/card-news/presets', label: '카드뉴스 플랫폼 프리셋', permission: PERMISSIONS.CARD_NEWS_MANAGE },
    ],
  },
  {
    title: '설정·관리',
    items: [
      { href: '/admin/settings/academy', label: '학원 기본정보', permission: PERMISSIONS.ACADEMY_MANAGE },
      { href: '/admin/settings/academics', label: '학교·학년 기준정보', permission: PERMISSIONS.ACADEMY_MANAGE },
      { href: '/admin/settings/admins', label: '관리자 계정', permission: PERMISSIONS.ADMINS_MANAGE },
      { href: '/admin/settings/roles', label: '역할·권한 관리', permission: PERMISSIONS.ROLES_MANAGE },
      { href: '/admin/reports', label: '보고서', permission: PERMISSIONS.AUDIT_VIEW },
      { href: '/admin/audit-logs', label: '감사 로그', permission: PERMISSIONS.AUDIT_VIEW },
    ],
  },
];
