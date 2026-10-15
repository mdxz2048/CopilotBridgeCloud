import {users,referrals,referralRewards,systemSettings,plans,subscriptions,auditLogs,walletTransactions,wallets} from '@bridge/db';
import {and,eq} from 'drizzle-orm';
import {applyWalletChange,type DbTransaction} from './wallet.js';
import {engagementPolicy} from './engagement-policy.js';
import {ApiError} from './errors.js';
const snapshotKey=(id:string)=>`signup_invite:${id}`;
const creditKey=(id:string)=>`invite_credit:${id}`;
type Snapshot={campaignId:string;referrerPoints:number;referredPoints:number;rewardDays:number};
/** Registration binds eligibility only. A later confirmed top-up unlocks the reward. */
export async function enrollSignupReward(tx:DbTransaction,referral:typeof referrals.$inferSelect){
 const policy=await engagementPolicy(tx);if(!policy.campaign.enabled)return null;
 const snapshot:Snapshot={campaignId:'invite-welcome-5',referrerPoints:50000,referredPoints:50000,rewardDays:7};
 await tx.insert(systemSettings).values({key:snapshotKey(referral.id),value:snapshot}).onConflictDoNothing();
 const [plan]=await tx.select().from(plans).where(and(eq(plans.code,'PAYG'),eq(plans.enabled,true))).limit(1);if(!plan)throw new ApiError(503,'PLAN_REQUIRED','按量套餐暂不可用，请稍后注册。');
 const now=new Date(),cn=new Date(now.getTime()+8*3600000),monthEnd=new Date(Date.UTC(cn.getUTCFullYear(),cn.getUTCMonth()+1,1)-8*3600000);
 await tx.insert(subscriptions).values({userId:referral.referredUserId,planId:plan.id,status:'ACTIVE',startedAt:now,currentPeriodStart:now,currentPeriodEnd:monthEnd});
 return {status:referral.status};
}
/** Only real positive manual credits or confirmed paid orders qualify; gifts and reductions never do. */
export async function qualifyInviteFromCredit(tx:DbTransaction,userId:string,source:{transactionId:string}|{orderId:string}){
 const [referral]=await tx.select().from(referrals).where(eq(referrals.referredUserId,userId)).for('update').limit(1);if(!referral||referral.status==='REJECTED'||referral.status==='REWARDED')return null;
 const [snapshot]=await tx.select({key:systemSettings.key}).from(systemSettings).where(eq(systemSettings.key,snapshotKey(referral.id))).limit(1);if(!snapshot)return null;
 if('transactionId' in source){const [credit]=await tx.select({points:walletTransactions.points,type:walletTransactions.type,userId:wallets.userId}).from(walletTransactions).innerJoin(wallets,eq(wallets.id,walletTransactions.walletId)).where(eq(walletTransactions.id,source.transactionId)).limit(1);if(!credit||credit.userId!==userId||credit.points<=0||!['ADMIN_ADJUSTMENT','PURCHASE'].includes(credit.type))return null;}
 else {const {billingOrders}=await import('@bridge/db');const [order]=await tx.select().from(billingOrders).where(eq(billingOrders.id,source.orderId)).limit(1);if(!order||order.userId!==userId||order.status!=='PAID'||Number(order.amount)<=0)return null;}
 await tx.insert(systemSettings).values({key:creditKey(referral.id),value:source}).onConflictDoNothing();return fulfillSignupReward(tx,referral.id);
}
export async function fulfillSignupReward(tx:DbTransaction,id:string){
 const [referral]=await tx.select().from(referrals).where(eq(referrals.id,id)).for('update').limit(1);if(!referral||referral.status==='REJECTED')return null;
 const [setting]=await tx.select().from(systemSettings).where(eq(systemSettings.key,snapshotKey(id))).limit(1);if(!setting)return null;
 if(referral.status==='REWARDED')return {status:'REWARDED' as const};
 const [credit]=await tx.select({key:systemSettings.key}).from(systemSettings).where(eq(systemSettings.key,creditKey(id))).limit(1);if(!credit)return {status:'AWAITING_TOPUP' as const};
 if(referral.riskFlags.length)return {status:'PENDING' as const};
 const snapshot=setting.value as Snapshot,now=new Date(),expiresAt=new Date(now.getTime()+snapshot.rewardDays*86400000);
 const owners=await tx.select({id:users.id,status:users.status}).from(users).where(eq(users.id,referral.referrerUserId)).for('update');
 const [newUser]=await tx.select({status:users.status}).from(users).where(eq(users.id,referral.referredUserId)).limit(1);
 if(owners[0]?.status!=='ACTIVE'||newUser?.status!=='ACTIVE'){await tx.update(referrals).set({status:'PENDING'}).where(eq(referrals.id,id));return {status:'PENDING' as const};}
 for(const [userId,points]of [[referral.referrerUserId,snapshot.referrerPoints],[referral.referredUserId,snapshot.referredPoints]] as const){
  const {transaction}=await applyWalletChange(tx,{userId,points,type:'REFERRAL_REWARD',referenceType:'REFERRAL',referenceId:id,idempotencyKey:`referral:${id}:${userId}`,expiresAt,metadata:{campaignId:snapshot.campaignId,trigger:'FIRST_TOPUP',rewardDays:snapshot.rewardDays}});
  await tx.insert(referralRewards).values({referralId:id,beneficiaryUserId:userId,points,walletTransactionId:transaction.id}).onConflictDoNothing();
 }
 await tx.update(referrals).set({status:'REWARDED',qualifiedAt:now}).where(eq(referrals.id,id));
 await tx.insert(auditLogs).values({actorId:referral.referredUserId,action:'FIRST_TOPUP_INVITE_REWARDED',targetType:'REFERRAL',targetId:id,metadata:snapshot});return {status:'REWARDED' as const};
}
