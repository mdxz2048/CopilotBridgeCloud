import { auditLogs, db, pool, users } from '@bridge/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { hashPassword } from '../security.js';

const email = z.email().parse(process.argv[2]).toLowerCase();
async function passwordFromStdin(): Promise<string> {
  if (process.stdin.isTTY) throw new Error('PASSWORD_STDIN_REQUIRED');
  let value = '';
  for await (const chunk of process.stdin) {
    value += chunk.toString();
    if (value.length > 4096) throw new Error('PASSWORD_TOO_LONG');
  }
  return z.string().min(16).max(256).parse(value.replace(/\r?\n$/, ''));
}
try {
  const password = await passwordFromStdin();
  const [admin] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!admin || admin.role !== 'ADMIN' || admin.status !== 'ACTIVE') throw new Error('ADMIN_ACCOUNT_NOT_ACTIVE');
  const passwordHash = await hashPassword(password);
  await db.transaction(async tx => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, admin.id));
    await tx.insert(auditLogs).values({ actorId: admin.id, action: 'ADMIN_PASSWORD_RESET', targetType: 'USER',
      targetId: admin.id, metadata: { method: 'OPERATOR_STDIN' } });
  });
  process.stdout.write(`${JSON.stringify({ adminEmail: email, passwordReset: 'PASS' })}\n`);
} catch (error) {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'ADMIN_PASSWORD_RESET_FAILED';
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
} finally { await pool.end(); }
