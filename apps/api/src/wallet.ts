import { db, plans, subscriptions, walletTransactions, wallets } from '@bridge/db';
import { eq } from 'drizzle-orm';
import { ApiError } from './core.js';

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type WalletChange = {
  userId: string; points: number; type: string; referenceType: string; referenceId: string; idempotencyKey: string;
  metadata?: Record<string, unknown>;
};

export async function walletSummary(userId: string) {
  const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
  return { balance: wallet?.balance ?? 0, unit: 'AI_POINT' as const };
}

export async function applyWalletChange(tx: DbTransaction, change: WalletChange) {
  if (!Number.isSafeInteger(change.points) || !change.points || Math.abs(change.points) > 1_000_000_000) throw new ApiError(400, 'INVALID_POINTS');
  await tx.insert(wallets).values({ userId: change.userId }).onConflictDoNothing();
  // Serializes all changes for one wallet, including retries with the same key.
  const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, change.userId)).for('update').limit(1);
  const [prior] = await tx.select().from(walletTransactions).where(eq(walletTransactions.idempotencyKey, change.idempotencyKey)).limit(1);
  if (prior) {
    if (prior.walletId !== wallet.id || prior.points !== change.points || prior.type !== change.type || prior.referenceType !== change.referenceType || prior.referenceId !== change.referenceId) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT');
    return { transaction: prior, duplicate: true };
  }
  const next = wallet.balance + change.points;
  if (next < 0) throw new ApiError(402, 'INSUFFICIENT_POINTS');
  if (!Number.isSafeInteger(next) || next > 2_147_483_647) throw new ApiError(409, 'WALLET_LIMIT_REACHED');
  const [updated] = await tx.update(wallets).set({ balance: next, updatedAt: new Date() }).where(eq(wallets.id, wallet.id)).returning();
  const [transaction] = await tx.insert(walletTransactions).values({ walletId: updated.id, points: change.points, balanceAfter: next, type: change.type, referenceType: change.referenceType, referenceId: change.referenceId, idempotencyKey: change.idempotencyKey, metadata: change.metadata ?? {} }).returning();
  return { transaction, duplicate: false };
}

export async function grantSubscriptionPoints(tx: DbTransaction, subscriptionId: string) {
  const [row] = await tx.select({ subscription: subscriptions, plan: plans }).from(subscriptions).innerJoin(plans, eq(subscriptions.planId, plans.id)).where(eq(subscriptions.id, subscriptionId)).limit(1);
  if (!row) throw new ApiError(404, 'SUBSCRIPTION_NOT_FOUND');
  if (row.plan.monthlyPoints <= 0) return null;
  if (row.plan.rolloverPolicy !== 'UNLIMITED') throw new ApiError(409, 'ROLLOVER_POLICY_NOT_IMPLEMENTED');
  return applyWalletChange(tx, { userId: row.subscription.userId, points: row.plan.monthlyPoints, type: 'SUBSCRIPTION_GRANT', referenceType: 'SUBSCRIPTION', referenceId: subscriptionId,
    idempotencyKey: `subscription:${subscriptionId}:${row.subscription.currentPeriodStart.toISOString()}` });
}

export async function adjustWalletByAdmin(userId: string, points: number, actorId: string, reason: string, idempotencyKey: string) {
  return db.transaction(tx => applyWalletChange(tx, { userId, points, type: 'ADMIN_ADJUSTMENT', referenceType: 'ADMIN', referenceId: actorId, idempotencyKey, metadata: { reason } }));
}
