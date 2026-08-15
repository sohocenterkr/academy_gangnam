import { eq } from 'drizzle-orm';
import { db } from '../db';
import { admins, roles } from '@shared/schema';
import { SUPER_ADMIN_ROLE_NAME, SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { hashPassword } from '../utils/password';
import { normalizeEmail } from '../utils/email';

interface BootstrapEnv {
  INITIAL_ADMIN_EMAIL: string;
  INITIAL_ADMIN_PASSWORD: string;
  INITIAL_ADMIN_NAME: string;
}

export interface BootstrapAdminOptions {
  roleName?: string;
}

export async function bootstrapAdmin(
  env: BootstrapEnv,
  options: BootstrapAdminOptions = {},
): Promise<void> {
  const roleName = options.roleName ?? SUPER_ADMIN_ROLE_NAME;

  const [existingSuperAdminRole] = await db
    .select()
    .from(roles)
    .where(eq(roles.name, roleName));

  if (existingSuperAdminRole) {
    const [existingAdmin] = await db
      .select()
      .from(admins)
      .where(eq(admins.roleId, existingSuperAdminRole.id));
    if (existingAdmin) {
      return;
    }
  }

  const role =
    existingSuperAdminRole ??
    (
      await db
        .insert(roles)
        .values({
          name: roleName,
          permissions: [SUPER_ADMIN_WILDCARD_PERMISSION],
          isSystem: true,
        })
        .returning()
    )[0];

  if (!role) {
    throw new Error('Failed to create or find the super-admin role during bootstrap.');
  }

  const passwordHash = await hashPassword(env.INITIAL_ADMIN_PASSWORD);

  try {
    await db.insert(admins).values({
      email: normalizeEmail(env.INITIAL_ADMIN_EMAIL),
      name: env.INITIAL_ADMIN_NAME,
      passwordHash,
      roleId: role.id,
      status: 'active',
    });
    console.log('Initial super-admin created.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('admins_email_unique')) {
      console.log('Initial super-admin already exists (race on first boot), skipping.');
      return;
    }
    throw error;
  }
}
