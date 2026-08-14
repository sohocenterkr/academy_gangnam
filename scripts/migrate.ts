import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from '../server/db';

async function main() {
  await migrate(db, { migrationsFolder: './migrations' });
  await pool.end();
  console.log('Migrations applied.');
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exitCode = 1;
});
