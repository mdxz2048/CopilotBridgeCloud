import { db, plans, subscriptions, walletLots, walletLotSpends, walletTransactions, wallets } from '@bridge/db';
import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import { ApiError } from './core.js';

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type WalletChange = {
  userId: string; points: number; type: string; referenceType: string; referenceId: string; idempotencyKey: string;
  metadata?: Record<string, unknown>; expiresAt?: Date | null;
};

async function expireLocked(tx: DbTransaction, wallet: typeof wallets.$inferSelect, now: Date) {
  const due = await tx.select().from(walletLots).where(and(eq(walletLots.walletId, wallet.id), gt(walletLots.remainingPoints, 0), lte(walletLots.expiresAt, now)))
    .orderBy(asc(walletLots.expiresAt), asc(walletLots.createdAt)).for('update');
  let balance = wallet.balance;
  for (const lot of due) {
    balance -= lot.remainingPoints;
    if (balance < 0) throw new ApiError(500, 'WALLET_LEDGER_MISMATCH');
    const [transaction] = await tx.insert(walletTransactions).values({ walletId: wallet.id, points: -lot.remainingPoints, balanceAfter: balance,
      type: 'EXPIRATION', referenceType: 'WALLET_LOT', referenceId: lot.id, idempotencyKey: `expiration:${lot.id}` }).returning();
    await tx.update(walletLots).set({ remainingPoints: 0 }).where(eq(walletLots.id, lot.id));
    await tx.insert(walletLotSpends).values({ lotId: lot.id, transactionId: transaction.id, points: lot.remainingPoints });
  }
  if (due.length) await tx.update(wallets).set({ balance, updatedAt: now }).where(eq(wallets.id, wallet.id));
  return balance;
}

export async function expireDueWalletLots(userId: string, at = new Date()) {
  return db.transaction(async tx => {
    const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, userId)).for('update').limit(1);
    return wallet ? expireLocked(tx, wallet, at) : 0;
  });
}

export async function expireDueWalletLotsForAll(batchSize = 200, at = new Date()) {
  const due = await db.selectDistinct({ userId: wallets.userId }).from(walletLots).innerJoin(wallets, eq(walletLots.walletId, wallets.id))
    .where(and(gt(walletLots.remainingPoints, 0), lte(walletLots.expiresAt, at))).limit(batchSize);
  for (const row of due) await expireDueWalletLots(row.userId, at);
  return due.length;
}

export async function walletSummary(userId: string) {
  return { balance: await expireDueWalletLots(userId), unit: 'AI_POINT' as const };
}

export async function applyWalletChange(tx: DbTransaction, change: WalletChange) {
  if (!Number.isSafeInteger(change.points) || !change.points || Math.abs(change.points) > 2_147_483_647) throw new ApiError(400, 'INVALID_POINTS');
  await tx.insert(wallets).values({ userId: change.userId }).onConflictDoNothing();
  // Serializes all changes for one wallet, including retries with the same key.
  const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, change.userId)).for('update').limit(1);
  const currentBalance = await expireLocked(tx, wallet, new Date());
  const [prior] = await tx.select().from(walletTransactions).where(eq(walletTransactions.idempotencyKey, change.idempotencyKey)).limit(1);
  if (prior) {
    if (prior.walletId !== wallet.id || prior.points !== change.points || prior.type !== change.type || prior.referenceType !== change.referenceType || prior.referenceId !== change.referenceId) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT');
    if (change.points > 0) {
      const [lot] = await tx.select().from(walletLots).where(eq(walletLots.sourceTransactionId, prior.id)).limit(1);
      if (!lot || (lot.expiresAt?.toISOString() ?? null) !== (change.expiresAt?.toISOString() ?? null)) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT');
    }
    return { transaction: prior, duplicate: true };
  }
  const next = currentBalance + change.points;
  if (next < 0) throw new ApiError(402, 'INSUFFICIENT_POINTS');
  if (!Number.isSafeInteger(next) || next > 2_147_483_647) throw new ApiError(409, 'WALLET_LIMIT_REACHED');
  const allocations: Array<{ lotId: string; points: number; remainingAfter: number }> = [];
  if (change.points < 0) {
    let needed = -change.points;
    const lots = await tx.select().from(walletLots).where(and(eq(walletLots.walletId, wallet.id), gt(walletLots.remainingPoints, 0)))
      .orderBy(sql`${walletLots.expiresAt} asc nulls last`, asc(walletLots.createdAt)).for('update');
    for (const lot of lots) {
      if (!needed) break;
      const points = Math.min(needed, lot.remainingPoints);
      allocations.push({ lotId: lot.id, points, remainingAfter: lot.remainingPoints - points });
      needed -= points;
    }
    if (needed) throw new ApiError(500, 'WALLET_LEDGER_MISMATCH');
  }
  const [updated] = await tx.update(wallets).set({ balance: next, updatedAt: new Date() }).where(eq(wallets.id, wallet.id)).returning();
  const [transaction] = await tx.insert(walletTransactions).values({ walletId: updated.id, points: change.points, balanceAfter: next, type: change.type, referenceType: change.referenceType, referenceId: change.referenceId, idempotencyKey: change.idempotencyKey, metadata: change.metadata ?? {} }).returning();
  if (change.points > 0) await tx.insert(walletLots).values({ walletId: wallet.id, sourceTransactionId: transaction.id, grantedPoints: change.points,
    remainingPoints: change.points, expiresAt: change.expiresAt ?? null });
  for (const allocation of allocations) {
    await tx.update(walletLots).set({ remainingPoints: allocation.remainingAfter }).where(eq(walletLots.id, allocation.lotId));
    await tx.insert(walletLotSpends).values({ lotId: allocation.lotId, transactionId: transaction.id, points: allocation.points });
  }
  return { transaction, duplicate: false };
}

export async function grantSubscriptionPoints(tx: DbTransaction, subscriptionId: string) {
  const [row] = await tx.select({ subscription: subscriptions, plan: plans }).from(subscriptions).innerJoin(plans, eq(subscriptions.planId, plans.id)).where(eq(subscriptions.id, subscriptionId)).limit(1);
  if (!row) throw new ApiError(404, 'SUBSCRIPTION_NOT_FOUND');
  if (row.plan.monthlyPoints <= 0) return null;
  if (!['NONE', 'UNLIMITED'].includes(row.plan.rolloverPolicy)) throw new ApiError(409, 'ROLLOVER_POLICY_INVALID');
  return applyWalletChange(tx, { userId: row.subscription.userId, points: row.plan.monthlyPoints, type: 'SUBSCRIPTION_GRANT', referenceType: 'SUBSCRIPTION', referenceId: subscriptionId,
    idempotencyKey: `subscription:${subscriptionId}:${row.subscription.currentPeriodStart.toISOString()}`,
    expiresAt: row.plan.rolloverPolicy === 'NONE' ? row.subscription.currentPeriodEnd : null });
}

export async function adjustWalletByAdmin(userId: string, points: number, actorId: string, reason: string, idempotencyKey: string) {
  return db.transaction(tx => applyWalletChange(tx, { userId, points, type: 'ADMIN_ADJUSTMENT', referenceType: 'ADMIN', referenceId: actorId, idempotencyKey, metadata: { reason } }));
}
