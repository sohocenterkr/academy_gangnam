export const PERMISSIONS = {
  ADMINS_MANAGE: 'admins:manage',
  ROLES_MANAGE: 'roles:manage',
  ACADEMY_MANAGE: 'academy:manage',
  GUARDIANS_MANAGE: 'guardians:manage',
  STUDENTS_MANAGE: 'students:manage',
  CHECKINS_MANAGE: 'checkins:manage',
  COURSES_MANAGE: 'courses:manage',
  MEDIA_MANAGE: 'media:manage',
  MESSAGING_MANAGE: 'messaging:manage',
  CARD_NEWS_MANAGE: 'cardNews:manage',
  AUDIT_VIEW: 'audit:view',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const SUPER_ADMIN_ROLE_NAME = '최고관리자';

export const SUPER_ADMIN_WILDCARD_PERMISSION = '*';
