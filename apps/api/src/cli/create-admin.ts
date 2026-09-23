import { db, pool, users } from '@bridge/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { hashPassword } from '../security.js';

const email = z.email().parse(process.env.ADMIN_BOOTSTRAP_EMAIL).toLowerCase();
async function passwordFromStdin(): Promise<string> {
  if (process.stdin.isTTY) throw new Error('Pipe the administrator password on stdin');
  let value = '';
  for await (const chunk of process.stdin) {
    value += chunk.toString();
    if (value.length > 4096) throw new Error('Administrator password is too long');
  }
  return value.replace(/\r?\n$/, '');
}
const password = z.string().min(16).parse(process.env.ADMIN_BOOTSTRAP_PASSWORD ?? await passwordFromStdin());
const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
if (existing) throw new Error('Admin email already exists');
await db.insert(users).values({ email, passwordHash: await hashPassword(password), role: 'ADMIN' });
process.stdout.write(`Created admin ${email}\n`);
await pool.end();
