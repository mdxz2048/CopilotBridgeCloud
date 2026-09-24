import { randomBytes, createHmac } from 'node:crypto';
import { db, devices, referralCodes, referralRewards, referrals, subscriptions, systemSettings, users } from '@bridge/db';
import { and, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ApiError } from './core.js';
import { config } from './config.js';
import { applyWalletChange, type DbTransaction } from './wallet.js';

const policySchema = z.object({ enabled: z.boolean(), minPaidAmount: z.number().nonnegative(), referrerPoints: z.number().int().min(0).max(1_000_000), referredPoints: z.number().int().min(0).max(1_000_000) });
export type ReferralPolicy = z.infer<typeof policySchema>;
export function hashRiskSignal(value: string) { return createHmac('sha256', config.REFRESH_TOKEN_PEPPER).update(value).digest('hex'); }

export async function referralCodeFor(userId: string) {
  const [existing] = await db.select().from(referralCodes).where(eq(referralCodes.userId, userId)).limit(1);
  if (existing) return existing;
  const code = randomBytes(10).toString('base64url').toUpperCase();
  const [created] = await db.insert(referralCodes).values({ userId, code }).onConflictDoNothing().returning();
  if (created) return created;
  const [raced] = await db.select().from(referralCodes).where(eq(referralCodes.userId, userId)).limit(1);
  if (!raced) throw new ApiError(503, 'REFERRAL_CODE_UNAVAILABLE');
  return raced;
}

export async function registerReferral(referredUserId: string, code: string, sourceDeviceId?: string, ip?: string) {
  return db.transaction(async tx => {
    await tx.execute(sql`select id from users where id = ${referredUserId} for update`);
    const [owned] = await tx.select().from(referrals).where(eq(referrals.referredUserId, referredUserId)).limit(1);
    if (owned) throw new ApiError(409, 'REFERRAL_NOT_ELIGIBLE');
    const [priorSub] = await tx.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.userId, referredUserId)).limit(1);
    if (priorSub) throw new ApiError(409, 'REFERRAL_NOT_ELIGIBLE');
    const [refCode] = await tx.select().from(referralCodes).where(and(eq(referralCodes.code, code.toUpperCase()), eq(referralCodes.status, 'ACTIVE'))).limit(1);
    if (!refCode) throw new ApiError(404, 'INVALID_REFERRAL_CODE');
    if (refCode.userId === referredUserId) throw new ApiError(409, 'REFERRAL_NOT_ELIGIBLE');
    const riskFlags: string[] = [];
    if (sourceDeviceId) {
      const [device] = await tx.select().from(devices).where(and(eq(devices.id, sourceDeviceId), eq(devices.userId, referredUserId))).limit(1);
      if (!device) throw new ApiError(403, 'DEVICE_NOT_REGISTERED');
      const [sameInstallation] = await tx.select({ id: devices.id }).from(devices).where(and(eq(devices.userId, refCode.userId), eq(devices.deviceId, device.deviceId))).limit(1);
      if (sameInstallation) riskFlags.push('SAME_INSTALLATION');
    }
    const registrationIpHash = ip ? hashRiskSignal(ip) : null;
    if (registrationIpHash) {
      const [velocity] = await tx.select({ count: sql<number>`count(*)` }).from(referrals)
        .where(and(eq(referrals.registrationIpHash, registrationIpHash), gte(referrals.registeredAt, new Date(Date.now() - 86400000))));
      if (Number(velocity.count) >= 5) riskFlags.push('REGISTRATION_VELOCITY');
    }
    const [referral] = await tx.insert(referrals).values({ referrerUserId: refCode.userId, referredUserId, referralCodeId: refCode.id,
      sourceDeviceId: sourceDeviceId ?? null, registrationIpHash, riskFlags, status: riskFlags.length ? 'PENDING' : 'REGISTERED' }).returning();
    return referral;
  });
}

export async function referralPolicy(tx: DbTransaction): Promise<ReferralPolicy | null> {
  const [setting] = await tx.select().from(systemSettings).where(eq(systemSettings.key, 'referral_policy')).limit(1);
  if (!setting) return null;
  return policySchema.parse(setting.value);
}

export async function qualifyReferralFromPaidOrder(tx: DbTransaction, userId: string, amount: number) {
  const [referral] = await tx.select().from(referrals).where(eq(referrals.referredUserId, userId)).for('update').limit(1);
  if (!referral || referral.status === 'REJECTED' || referral.status === 'REWARDED' || referral.riskFlags.length) return null;
  const policy = await referralPolicy(tx);
  if (!policy?.enabled || amount < policy.minPaidAmount) return null;
  await tx.update(referrals).set({ status: 'QUALIFIED', qualifiedAt: new Date() }).where(eq(referrals.id, referral.id));
  for (const [beneficiaryUserId, points] of [[referral.referrerUserId, policy.referrerPoints], [referral.referredUserId, policy.referredPoints]] as const) {
    if (!points) continue;
    const [existing] = await tx.select().from(referralRewards).where(and(eq(referralRewards.referralId, referral.id), eq(referralRewards.beneficiaryUserId, beneficiaryUserId))).limit(1);
    if (existing) continue;
    const { transaction } = await applyWalletChange(tx, { userId: beneficiaryUserId, points, type: 'REFERRAL_REWARD', referenceType: 'REFERRAL', referenceId: referral.id,
      idempotencyKey: `referral:${referral.id}:${beneficiaryUserId}` });
    await tx.insert(referralRewards).values({ referralId: referral.id, beneficiaryUserId, points, walletTransactionId: transaction.id }).onConflictDoNothing();
  }
  await tx.update(referrals).set({ status: 'REWARDED' }).where(eq(referrals.id, referral.id));
  return referral.id;
}
