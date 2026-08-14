import { eq } from 'drizzle-orm';
import { db } from '../db';
import { admins, roles } from '@shared/schema';
import { SUPER_ADMIN_ROLE_NAME, SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { hashPassword } from '../utils/password';

interface BootstrapEnv {
  INITIAL_ADMIN_EMAIL: string;
  INITIAL_ADMIN_PASSWORD: string;
  INITIAL_ADMIN_NAME: string;
}

export async function bootstrapAdmin(env: BootstrapEnv): Promise<void> {
  const [existingSuperAdminRole] = await db
    .select()
    .from(roles)
    .where(eq(roles.name, SUPER_ADMIN_ROLE_NAME));

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
          name: SUPER_ADMIN_ROLE_NAME,
          permissions: [SUPER_ADMIN_WILDCARD_PERMISSION],
          isSystem: true,
        })
        .returning()
    )[0];

  const passwordHash = await hashPassword(env.INITIAL_ADMIN_PASSWORD);

  try {
    await db.insert(admins).values({
      email: env.INITIAL_ADMIN_EMAIL,
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
