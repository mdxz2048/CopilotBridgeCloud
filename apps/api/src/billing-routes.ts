import type { FastifyInstance } from 'fastify';
import { auditLogs, db, devices, deviceBillingPeriods, deviceBillingStates, refreshTokens, users, webSessions } from '@bridge/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { actor, ApiError } from './core.js';
import { walletSummary } from './wallet.js';

export function registerBillingRoutes(app: FastifyInstance) {
  app.get('/api/v1/me/bills', async req => {
    const a = await actor(req);
    const { kind, page, pageSize } = z.object({ kind: z.enum(['all', 'recharge', 'consumption']).default('all'),
      page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
    const wallet = await walletSummary(a.user.id);
    // The partial non-USAGE index and saved periods keep reads off per-request usage history.
    const credits = sql`select t.id, 'BALANCE'::text as category, t.type, t.points::bigint as points,
      t.balance_after as "balanceAfter", t.created_at as "occurredAt", null::timestamptz as "startedAt",
      null::timestamptz as "endedAt", null::text as "deviceName", null::uuid as "deviceId", null::text as "periodKind"
      from wallet_transactions t join wallets w on w.id=t.wallet_id
      where w.user_id=${a.user.id} and t.type <> 'USAGE' ${kind === 'recharge' ? sql`and t.points>0` : sql``}`;
    const consumption = sql`select p.id, 'CONSUMPTION'::text as category, 'USAGE_INTERVAL'::text as type,
      -p.charged_points as points, null::integer as "balanceAfter", p.ended_at as "occurredAt",
      p.started_at as "startedAt", p.ended_at as "endedAt", p.device_name as "deviceName", p.binding_id as "deviceId", p.kind as "periodKind"
      from device_billing_periods p where p.user_id=${a.user.id}`;
    const rows = kind === 'recharge' ? credits : kind === 'consumption' ? consumption : sql`${credits} union all ${consumption}`;
    const [list, count, added, spent, pending] = await Promise.all([
      db.execute(sql`select * from (${rows}) bills order by "occurredAt" desc, id desc limit ${pageSize} offset ${(page - 1) * pageSize}`),
      db.execute(sql`select count(*)::integer as total from (${rows}) bills`),
      db.execute(sql`select coalesce(sum(t.points) filter(where t.points>0),0)::bigint as total from wallet_transactions t
        join wallets w on w.id=t.wallet_id where w.user_id=${a.user.id} and t.type <> 'USAGE'`),
      db.execute(sql`select coalesce(sum(charged_points),0)::bigint as total from device_billing_periods where user_id=${a.user.id}`),
      db.execute(sql`select s.device_id as id, d.device_id as "deviceId", d.device_name as "deviceName", s.started_at as "startedAt"
        from device_billing_states s join devices d on d.id=s.device_id where s.user_id=${a.user.id} and s.started_at is not null
        order by s.started_at desc limit 100`),
    ]);
    return { data: list.rows.map(row => ({ ...row, points: Number(row.points), balanceAfter: row.balanceAfter === null ? null : Number(row.balanceAfter) })),
      pending: kind === 'recharge' ? [] : pending.rows, total: Number(count.rows[0].total), page, pageSize,
      summary: { balance: wallet.balance, totalAdded: Number(added.rows[0].total), totalConsumed: Number(spent.rows[0].total) } };
  });

  app.post('/api/v1/me/devices/revoke-all', async (req, reply) => {
    const a = await actor(req);
    if (!a.web) throw new ApiError(403, 'FORBIDDEN');
    z.object({ confirm: z.literal(true) }).parse(req.body);
    const result = await db.transaction(async tx => {
      const [user] = await tx.select().from(users).where(eq(users.id, a.user.id)).for('update').limit(1);
      if (!user || user.status !== 'ACTIVE') throw new ApiError(403, 'ACCOUNT_DISABLED');
      const current = await tx.select({ status: devices.status }).from(devices).where(eq(devices.userId, user.id));
      const at = new Date();
      await tx.update(devices).set({ status: sql`case when ${devices.status}='BLOCKED' then 'BLOCKED' else 'REVOKED' end`,
        authVersion: sql`${devices.authVersion}+1`, updatedAt: at }).where(eq(devices.userId, user.id));
      await tx.update(refreshTokens).set({ revokedAt: at }).where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)));
      await tx.update(webSessions).set({ revokedAt: at }).where(and(eq(webSessions.userId, user.id), isNull(webSessions.revokedAt)));
      const revokedDevices = current.filter(device => device.status === 'ACTIVE').length;
      await tx.insert(auditLogs).values({ actorId: user.id, action: 'ALL_DEVICES_REVOKED', targetType: 'USER', targetId: user.id, metadata: { revokedDevices, includesWeb: true } });
      return { ok: true, revokedDevices, webSessionsRevoked: true };
    });
    reply.clearCookie('bridge_session', { path: '/' });
    return result;
  });
}
