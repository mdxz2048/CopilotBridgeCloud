import {users,referrals,referralRewards,systemSettings,plans,subscriptions,auditLogs} from '@bridge/db';
import {and,eq} from 'drizzle-orm';
import {applyWalletChange,type DbTransaction} from './wallet.js';
import {engagementPolicy} from './engagement-policy.js';
import {ApiError} from './errors.js';
const snapshotKey=(id:string)=>`signup_invite:${id}`;
type Snapshot={campaignId:string;referrerPoints:number;referredPoints:number;rewardDays:number};
/** Only invoked inside successful new-account registration, never by late referral binding. */
export async function enrollSignupReward(tx:DbTransaction,referral:typeof referrals.$inferSelect){
 const policy=await engagementPolicy(tx);if(!policy.campaign.enabled)return null;
 const snapshot:Snapshot={campaignId:'invite-welcome-5',referrerPoints:50000,referredPoints:50000,rewardDays:7};
 await tx.insert(systemSettings).values({key:snapshotKey(referral.id),value:snapshot}).onConflictDoNothing();
 return fulfillSignupReward(tx,referral.id);
}
export async function fulfillSignupReward(tx:DbTransaction,id:string){
 const [referral]=await tx.select().from(referrals).where(eq(referrals.id,id)).for('update').limit(1);
 if(!referral||referral.status==='REJECTED')return null;
 const [setting]=await tx.select().from(systemSettings).where(eq(systemSettings.key,snapshotKey(id))).limit(1);if(!setting)return null;
 if(referral.status==='REWARDED')return {status:'REWARDED' as const};
 if(referral.riskFlags.length)return {status:'PENDING' as const};
 const snapshot=setting.value as Snapshot;
 const now=new Date(),expiresAt=new Date(now.getTime()+snapshot.rewardDays*86400000);
 const owners=await tx.select({id:users.id,status:users.status}).from(users).where(eq(users.id,referral.referrerUserId)).for('update');
 const [newUser]=await tx.select({status:users.status}).from(users).where(eq(users.id,referral.referredUserId)).limit(1);
 if(owners[0]?.status!=='ACTIVE'||newUser?.status!=='ACTIVE'){await tx.update(referrals).set({status:'PENDING'}).where(eq(referrals.id,id));return {status:'PENDING' as const};}
 const [plan]=await tx.select().from(plans).where(and(eq(plans.code,'PAYG'),eq(plans.enabled,true))).limit(1);if(!plan)throw new ApiError(503,'PLAN_REQUIRED','邀请体验套餐暂不可用，请稍后注册。');
 for(const [userId,points]of [[referral.referrerUserId,snapshot.referrerPoints],[referral.referredUserId,snapshot.referredPoints]] as const){
  const {transaction}=await applyWalletChange(tx,{userId,points,type:'REFERRAL_REWARD',referenceType:'REFERRAL',referenceId:id,idempotencyKey:`referral:${id}:${userId}`,expiresAt,metadata:{campaignId:snapshot.campaignId,trigger:'REGISTRATION',rewardDays:snapshot.rewardDays}});
  await tx.insert(referralRewards).values({referralId:id,beneficiaryUserId:userId,points,walletTransactionId:transaction.id}).onConflictDoNothing();
 }
 const cn=new Date(now.getTime()+8*3600000),monthEnd=new Date(Date.UTC(cn.getUTCFullYear(),cn.getUTCMonth()+1,1)-8*3600000);await tx.insert(subscriptions).values({userId:referral.referredUserId,planId:plan.id,status:'ACTIVE',startedAt:now,currentPeriodStart:now,currentPeriodEnd:monthEnd});
 await tx.update(referrals).set({status:'REWARDED',qualifiedAt:now}).where(eq(referrals.id,id));
 await tx.insert(auditLogs).values({actorId:referral.referredUserId,action:'SIGNUP_INVITE_REWARDED',targetType:'REFERRAL',targetId:id,metadata:snapshot});return {status:'REWARDED' as const};
}
