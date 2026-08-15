import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const admins = pgTable(
  'admins',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    status: text('status', { enum: ['active', 'inactive', 'locked'] })
      .notNull()
      .default('active'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('admins_email_unique').on(table.email)]
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.id),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('auth_sessions_token_hash_unique').on(table.tokenHash)]
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.id),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('password_reset_tokens_token_hash_unique').on(table.tokenHash)]
);

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  adminId: uuid('admin_id').references(() => admins.id),
  roleSnapshot: text('role_snapshot'),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  beforeDataSafe: jsonb('before_data_safe'),
  afterDataSafe: jsonb('after_data_safe'),
  result: text('result', { enum: ['success', 'failure'] }).notNull(),
  requestId: text('request_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const academySettings = pgTable('academy_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  academyName: text('academy_name').notNull(),
  phoneNormalized: text('phone_normalized'),
  address: text('address'),
  senderName: text('sender_name'),
  logoMediaId: text('logo_media_id'),
  brandColors: jsonb('brand_colors'),
  brandFonts: jsonb('brand_fonts'),
  updatedBy: uuid('updated_by').references(() => admins.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const schools = pgTable(
  'schools',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    region: text('region'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => admins.id),
    updatedBy: uuid('updated_by').references(() => admins.id),
  },
  (table) => [
    uniqueIndex('schools_active_name_unique')
      .on(table.name)
      .where(sql`${table.isActive} = true`),
  ]
);

export const gradeLevels = pgTable(
  'grade_levels',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => admins.id),
    updatedBy: uuid('updated_by').references(() => admins.id),
  },
  (table) => [
    uniqueIndex('grade_levels_active_name_unique')
      .on(table.name)
      .where(sql`${table.isActive} = true`),
  ]
);

export const guardians = pgTable(
  'guardians',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    phoneNormalized: text('phone_normalized').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => admins.id),
    updatedBy: uuid('updated_by').references(() => admins.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('guardians_phone_idx').on(table.phoneNormalized)]
);

export const students = pgTable(
  'students',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    birthDate: date('birth_date'),
    schoolId: uuid('school_id').references(() => schools.id),
    gradeLevelId: uuid('grade_level_id')
      .notNull()
      .references(() => gradeLevels.id),
    phoneNormalized: text('phone_normalized').notNull(),
    address: text('address'),
    registrationDate: date('registration_date').notNull(),
    status: text('status', { enum: ['enrolled', 'paused', 'withdrawn', 'graduated'] })
      .notNull()
      .default('enrolled'),
    statusEffectiveDate: date('status_effective_date').notNull(),
    specialNotes: text('special_notes'),
    counselingNotes: text('counseling_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => admins.id),
    updatedBy: uuid('updated_by').references(() => admins.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('students_phone_idx').on(table.phoneNormalized)]
);

export const studentGuardians = pgTable(
  'student_guardians',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    guardianId: uuid('guardian_id')
      .notNull()
      .references(() => guardians.id),
    relationship: text('relationship'),
    isPrimary: boolean('is_primary').notNull().default(false),
    receiveMessages: boolean('receive_messages').notNull().default(true),
    useForCheckin: boolean('use_for_checkin').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('student_guardians_student_guardian_unique').on(table.studentId, table.guardianId),
    uniqueIndex('student_guardians_primary_unique')
      .on(table.studentId)
      .where(sql`${table.isPrimary} = true`),
  ]
);
