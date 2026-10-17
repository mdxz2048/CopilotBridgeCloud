import { db, deviceBillingPeriods, deviceBillingStates, devices } from '@bridge/db';
import { eq, sql } from 'drizzle-orm';
import { ApiError } from './errors.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Device = typeof devices.$inferSelect;

// Called only after a successful wallet debit, in that same transaction.
export async function accumulateDeviceCharge(tx: Tx, userId: string, deviceId: string, points: number) {
  if (!points) return;
  if (!Number.isSafeInteger(points) || points < 0) throw new ApiError(500, 'WALLET_LEDGER_MISMATCH');
  const [state] = await tx.insert(deviceBillingStates).values({ deviceId, userId, chargedPoints: points })
    .onConflictDoUpdate({ target: deviceBillingStates.deviceId,
      set: { chargedPoints: sql`${deviceBillingStates.chargedPoints} + ${points}`, updatedAt: new Date() } }).returning();
  if (state.userId !== userId || !Number.isSafeInteger(state.chargedPoints)) throw new ApiError(500, 'WALLET_LEDGER_MISMATCH');
}

// Shares the counter lock with settlement, so late stream charges enter the next interval.
export async function advanceDeviceBilling(tx: Tx, userId: string, device: Device, eventId: string) {
  await tx.insert(deviceBillingStates).values({ deviceId: device.id, userId }).onConflictDoNothing();
  const [state] = await tx.select().from(deviceBillingStates).where(eq(deviceBillingStates.deviceId, device.id)).for('update').limit(1);
  const at = new Date();
  const points = state.chargedPoints - state.settledPoints;
  if (state.userId !== userId || !Number.isSafeInteger(points) || points < 0) throw new ApiError(500, 'WALLET_LEDGER_MISMATCH');
  let previous = null;
  if (state.startedAt || points > 0) {
    const [period] = await tx.insert(deviceBillingPeriods).values({ userId, deviceId: device.id,
      deviceName: device.deviceName, bindingId: device.deviceId,
      kind: state.startedAt ? 'SESSION' : 'HISTORICAL', startedAt: state.startedAt, endedAt: at,
      chargedPoints: points, startEventId: state.startEventId, endEventId: eventId }).returning();
    previous = { id: period.id, kind: period.kind, points: period.chargedPoints,
      startedAt: period.startedAt?.toISOString() ?? null, endedAt: period.endedAt.toISOString() };
  }
  await tx.update(deviceBillingStates).set({ settledPoints: state.chargedPoints, startedAt: at, startEventId: eventId, updatedAt: at })
    .where(eq(deviceBillingStates.deviceId, device.id));
  return { at, previous };
}
