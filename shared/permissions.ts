export const PERMISSIONS = {
  ADMINS_MANAGE: 'admins:manage',
  ROLES_MANAGE: 'roles:manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const SUPER_ADMIN_ROLE_NAME = '최고관리자';

export const SUPER_ADMIN_WILDCARD_PERMISSION = '*';
