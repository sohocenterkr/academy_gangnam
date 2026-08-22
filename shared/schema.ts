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

export const checkIns = pgTable(
  'check_ins',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    checkInDate: date('check_in_date').notNull(),
    checkInAt: timestamp('check_in_at', { withTimezone: true }).notNull(),
    source: text('source', { enum: ['kiosk', 'admin', 'import'] }).notNull(),
    status: text('status', { enum: ['active', 'canceled'] }).notNull().default('active'),
    idempotencyKey: text('idempotency_key').notNull(),
    exceptionReason: text('exception_reason'),
    isException: boolean('is_exception').notNull().default(false),
    createdBy: uuid('created_by').references(() => admins.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('check_ins_idempotency_key_unique').on(table.idempotencyKey),
    uniqueIndex('check_ins_student_date_active_unique')
      .on(table.studentId, table.checkInDate)
      .where(sql`${table.status} = 'active' AND ${table.isException} = false`),
    index('check_ins_date_at_idx').on(table.checkInDate, table.checkInAt),
    index('check_ins_student_date_idx').on(table.studentId, table.checkInDate),
  ]
);

export const checkInChangeLogs = pgTable('check_in_change_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  checkInId: uuid('check_in_id')
    .notNull()
    .references(() => checkIns.id),
  action: text('action', { enum: ['create', 'update', 'cancel', 'exception_create'] }).notNull(),
  beforeData: jsonb('before_data'),
  afterData: jsonb('after_data'),
  reason: text('reason'),
  adminId: uuid('admin_id').references(() => admins.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const studentCheckinPhones = pgTable(
  'student_checkin_phones',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    sourceType: text('source_type', { enum: ['student', 'guardian'] }).notNull(),
    sourceId: uuid('source_id').notNull(),
    phoneNormalized: text('phone_normalized').notNull(),
    phoneLast4: text('phone_last4').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('student_checkin_phones_source_unique').on(table.studentId, table.sourceType, table.sourceId),
    index('student_checkin_phones_last4_active_idx').on(table.phoneLast4, table.isActive),
    index('student_checkin_phones_student_active_idx').on(table.studentId, table.isActive),
  ]
);

export const instructors = pgTable('instructors', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  phoneNormalized: text('phone_normalized').notNull(),
  subjects: jsonb('subjects').$type<string[]>().notNull().default([]),
  adminId: uuid('admin_id').references(() => admins.id),
  status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  createdBy: uuid('created_by').references(() => admins.id),
  updatedBy: uuid('updated_by').references(() => admins.id),
});

export const courses = pgTable(
  'courses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    category: text('category'),
    targetGradeIds: jsonb('target_grade_ids').$type<string[]>().notNull().default([]),
    instructorId: uuid('instructor_id').references(() => instructors.id),
    classroom: text('classroom'),
    capacity: integer('capacity'),
    baseFee: integer('base_fee'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    status: text('status', { enum: ['recruiting', 'closed', 'ended', 'inactive'] })
      .notNull()
      .default('recruiting'),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by').references(() => admins.id),
    updatedBy: uuid('updated_by').references(() => admins.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('courses_code_unique')
      .on(table.code)
      .where(sql`${table.deletedAt} IS NULL`),
  ]
);

export const courseSchedules = pgTable('course_schedules', {
  id: uuid('id').defaultRandom().primaryKey(),
  courseId: uuid('course_id')
    .notNull()
    .references(() => courses.id),
  dayOfWeek: integer('day_of_week').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  classroom: text('classroom'),
  instructorId: uuid('instructor_id').references(() => instructors.id),
  repeatStartDate: date('repeat_start_date'),
  repeatEndDate: date('repeat_end_date'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  createdBy: uuid('created_by').references(() => admins.id),
  updatedBy: uuid('updated_by').references(() => admins.id),
});

export const courseExceptions = pgTable('course_exceptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  courseId: uuid('course_id')
    .notNull()
    .references(() => courses.id),
  scheduleId: uuid('schedule_id').references(() => courseSchedules.id),
  exceptionType: text('exception_type', { enum: ['cancellation', 'makeup'] }).notNull(),
  eventDate: date('event_date').notNull(),
  startTime: text('start_time'),
  endTime: text('end_time'),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  createdBy: uuid('created_by').references(() => admins.id),
  updatedBy: uuid('updated_by').references(() => admins.id),
});

export const enrollments = pgTable(
  'enrollments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id),
    startDate: date('start_date').notNull(),
    plannedEndDate: date('planned_end_date'),
    actualEndDate: date('actual_end_date'),
    status: text('status', { enum: ['waiting', 'active', 'paused', 'ended', 'canceled'] })
      .notNull()
      .default('active'),
    tuitionAmount: integer('tuition_amount'),
    adjustmentNote: text('adjustment_note'),
    memo: text('memo'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by').references(() => admins.id),
    updatedBy: uuid('updated_by').references(() => admins.id),
  },
  (table) => [
    index('enrollments_student_status_start_idx').on(table.studentId, table.status, table.startDate),
    index('enrollments_course_status_start_idx').on(table.courseId, table.status, table.startDate),
  ]
);

export const uploadSessions = pgTable(
  'upload_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerAdminId: uuid('owner_admin_id')
      .notNull()
      .references(() => admins.id),
    purpose: text('purpose').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    expectedResourceType: text('expected_resource_type', { enum: ['image', 'video', 'raw'] }).notNull(),
    expectedFolder: text('expected_folder').notNull(),
    expectedBytes: integer('expected_bytes'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: text('status', { enum: ['pending', 'completed', 'expired', 'rejected'] })
      .notNull()
      .default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('upload_sessions_owner_status_idx').on(table.ownerAdminId, table.status),
    index('upload_sessions_status_expires_idx').on(table.status, table.expiresAt),
  ]
);

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerAdminId: uuid('owner_admin_id')
      .notNull()
      .references(() => admins.id),
    purpose: text('purpose').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    cloudinaryPublicId: text('cloudinary_public_id').notNull(),
    cloudinaryAssetId: text('cloudinary_asset_id'),
    secureUrl: text('secure_url').notNull(),
    resourceType: text('resource_type', { enum: ['image', 'video', 'raw'] }).notNull(),
    format: text('format'),
    mimeType: text('mime_type'),
    bytes: integer('bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    duration: integer('duration'),
    status: text('status', { enum: ['active', 'pending_delete', 'deleted', 'orphan_review', 'error'] })
      .notNull()
      .default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => admins.id),
  },
  (table) => [
    uniqueIndex('media_assets_public_id_resource_type_unique').on(table.cloudinaryPublicId, table.resourceType),
    index('media_assets_target_idx').on(table.targetType, table.targetId),
    index('media_assets_status_expires_idx').on(table.status, table.expiresAt),
  ]
);

export const integrationSettings = pgTable(
  'integration_settings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    provider: text('provider', { enum: ['pushbullet', 'resend', 'cloudinary', 'ai_provider'] }).notNull(),
    displayName: text('display_name').notNull(),
    encryptedConfig: text('encrypted_config'),
    status: text('status', { enum: ['connected', 'disconnected', 'error'] })
      .notNull()
      .default('disconnected'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    lastErrorCode: text('last_error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => admins.id),
    updatedBy: uuid('updated_by').references(() => admins.id),
  },
  (table) => [uniqueIndex('integration_settings_provider_unique').on(table.provider)]
);

export const messagingDevices = pgTable(
  'messaging_devices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrationSettings.id),
    externalDeviceId: text('external_device_id').notNull(),
    nickname: text('nickname').notNull(),
    deviceType: text('device_type'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastErrorCode: text('last_error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('messaging_devices_integration_external_unique').on(table.integrationId, table.externalDeviceId)]
);

export const messageTemplates = pgTable('message_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  category: text('category'),
  messageType: text('message_type', { enum: ['informational', 'marketing'] }).notNull(),
  body: text('body').notNull(),
  description: text('description'),
  defaultMediaId: uuid('default_media_id').references(() => mediaAssets.id),
  allowedRoles: jsonb('allowed_roles').$type<string[]>().notNull().default([]),
  status: text('status', { enum: ['active', 'inactive'] })
    .notNull()
    .default('active'),
  usageCount: integer('usage_count').notNull().default(0),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => admins.id),
  updatedBy: uuid('updated_by').references(() => admins.id),
});

export const platformPresets = pgTable('platform_presets', {
  id: uuid('id').defaultRandom().primaryKey(),
  platform: text('platform').notNull(),
  postType: text('post_type').notNull(),
  name: text('name').notNull(),
  widthPx: integer('width_px').notNull(),
  heightPx: integer('height_px').notNull(),
  safeArea: jsonb('safe_area').$type<{ top: number; right: number; bottom: number; left: number }>(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').references(() => admins.id),
  updatedBy: uuid('updated_by').references(() => admins.id),
});

export const cardNewsProjects = pgTable('card_news_projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  presetId: uuid('preset_id')
    .notNull()
    .references(() => platformPresets.id),
  title: text('title'),
  story: text('story'),
  eventDate: date('event_date'),
  relatedCourseId: uuid('related_course_id').references(() => courses.id),
  relatedStudentId: uuid('related_student_id').references(() => students.id),
  studentNameDisplayMode: text('student_name_display_mode', { enum: ['full', 'masked', 'hidden'] })
    .notNull()
    .default('masked'),
  hashtags: jsonb('hashtags').$type<string[]>().notNull().default([]),
  showAcademyInfo: boolean('show_academy_info').notNull().default(true),
  aiProvider: text('ai_provider'),
  aiModel: text('ai_model'),
  sendPhotosToAi: boolean('send_photos_to_ai').notNull().default(false),
  privacyConfirmedBy: uuid('privacy_confirmed_by').references(() => admins.id),
  privacyConfirmedAt: timestamp('privacy_confirmed_at', { withTimezone: true }),
  estimatedCost: integer('estimated_cost'),
  actualUsage: jsonb('actual_usage'),
  status: text('status', {
    enum: ['draft', 'uploading', 'generating', 'editing', 'rendering', 'ready', 'partial_error', 'expired', 'deleted'],
  })
    .notNull()
    .default('draft'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => admins.id),
  updatedBy: uuid('updated_by').references(() => admins.id),
});

export const cardNewsCards = pgTable(
  'card_news_cards',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => cardNewsProjects.id),
    sortOrder: integer('sort_order').notNull().default(0),
    layoutJson: jsonb('layout_json'),
    title: text('title'),
    body: text('body'),
    renderedMediaId: uuid('rendered_media_id').references(() => mediaAssets.id),
    status: text('status', { enum: ['draft', 'ready'] })
      .notNull()
      .default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => admins.id),
    updatedBy: uuid('updated_by').references(() => admins.id),
  },
  (table) => [index('card_news_cards_project_sort_idx').on(table.projectId, table.sortOrder)]
);

export const cardNewsMedia = pgTable(
  'card_news_media',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => cardNewsProjects.id),
    cardId: uuid('card_id').references(() => cardNewsCards.id),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => mediaAssets.id),
    role: text('role', { enum: ['source', 'background', 'logo', 'output'] }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [index('card_news_media_project_idx').on(table.projectId)]
);

export const aiGenerationLogs = pgTable('ai_generation_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => cardNewsProjects.id),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  photosSent: integer('photos_sent').notNull().default(0),
  inputSummarySafe: text('input_summary_safe'),
  outputJson: jsonb('output_json'),
  usageJson: jsonb('usage_json'),
  estimatedCost: integer('estimated_cost'),
  actualCost: integer('actual_cost'),
  status: text('status', { enum: ['pending', 'success', 'failed'] })
    .notNull()
    .default('pending'),
  errorCode: text('error_code'),
  createdBy: uuid('created_by').references(() => admins.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
