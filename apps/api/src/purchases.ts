import { randomBytes } from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {db,purchaseClaims,purchaseTickets,purchaseReviews,rewardNotices,referrals,users,devices,webSessions,auditLogs} from '@bridge/db';
import {and,eq,desc,isNull,sql,lt} from 'drizzle-orm';
import {z} from 'zod';
import {PurchaseClaimInputSchema,PurchaseReviewSchema} from '@bridge/contract';
import {actor,admin,ApiError} from './core.js';
import {config} from './config.js';
import {hashRefresh} from './security.js';
import {applyWalletChange,type DbTransaction} from './wallet.js';
import {qualifyInviteFromCredit} from './signup-rewards.js';
import {enqueuePurchaseMail,registerPurchaseMailWorker} from './purchase-mail.js';
const lifetime=10*60000,cookieName='bridge_purchase',cookiePath='/api/v1/purchase-mobile';
const fresh=()=>randomBytes(32).toString('base64url');
const id=(value:unknown)=>z.uuid().parse((value as {id:string}).id);
const expired=()=>new ApiError(410,'PURCHASE_LINK_EXPIRED','提交链接已失效，请返回 Bridge 重新生成二维码。');
export function paidRmbPoints(value:string){const parts=value.split('.');const result=BigInt(parts[0])*10000n+BigInt((parts[1]??'').padEnd(2,'0'))*100n;if(result<=0n||result>2147483600n)throw new ApiError(400,'INVALID_AMOUNT','请输入有效的实付金额。');return Number(result);}
function publicClaim(row:typeof purchaseClaims.$inferSelect){return {id:row.id,orderNo:row.orderNo,status:row.status,createdAt:row.createdAt.toISOString(),submittedAt:row.submittedAt.toISOString(),deadlineAt:row.deadlineAt.toISOString(),reviewedAt:row.reviewedAt?.toISOString()??null,creditedRmb:row.points===null?null:row.points/10000,reason:row.reason,attempt:row.attempt};}
function mask(email:string){const [name,host]=email.split('@');return `${name.slice(0,1)}***@${host}`;}
function origin(req:FastifyRequest){if(req.headers.origin!==config.PUBLIC_BASE_URL)throw new ApiError(403,'CSRF_REJECTED');}
async function validTicket(tx:DbTransaction,ticket:typeof purchaseTickets.$inferSelect){
 if(ticket.revokedAt||ticket.expiresAt.getTime()<=Date.now())throw expired();
 const [user]=await tx.select().from(users).where(eq(users.id,ticket.userId)).limit(1);if(!user||user.status!=='ACTIVE')throw expired();
 if(ticket.deviceId){const [device]=await tx.select().from(devices).where(eq(devices.id,ticket.deviceId)).limit(1);if(!device||device.userId!==user.id||device.status!=='ACTIVE'||device.authVersion!==ticket.deviceVersion)throw expired();}
 else if(ticket.webSessionId){const [session]=await tx.select().from(webSessions).where(eq(webSessions.id,ticket.webSessionId)).limit(1);if(!session||session.userId!==user.id||session.revokedAt||session.expiresAt.getTime()<=Date.now())throw expired();}
 else throw expired();
 return user;
}
async function mobileTicket(req:FastifyRequest,tx:DbTransaction,lock=false){
 const secret=req.cookies[cookieName];if(!secret||!/^[A-Za-z0-9_-]{43}$/.test(secret))throw expired();
 const [found]=await tx.select().from(purchaseTickets).where(eq(purchaseTickets.mobileHash,hashRefresh(secret))).limit(1);if(!found||req.headers['x-purchase-ticket']!==found.id)throw expired();
 if(lock){await tx.select({id:users.id}).from(users).where(eq(users.id,found.userId)).for('update');}
 const [ticket]=await tx.select().from(purchaseTickets).where(eq(purchaseTickets.id,found.id)).for(lock?'update':'share').limit(1);
 if(!ticket)throw expired();const user=await validTicket(tx,ticket);return {ticket,user};
}
async function mobileView(tx:DbTransaction,ticket:typeof purchaseTickets.$inferSelect,user:typeof users.$inferSelect){const [claim]=ticket.claimId?await tx.select().from(purchaseClaims).where(eq(purchaseClaims.id,ticket.claimId)).limit(1):[];return {ticketId:ticket.id,maskedAccount:mask(user.email),expiresAt:ticket.expiresAt.toISOString(),claim:claim?publicClaim(claim):null};}
export async function registerPurchases(app:FastifyInstance){
 registerPurchaseMailWorker(app);
 app.addHook('onRequest',async(req,reply)=>{if(req.url.split('?')[0].includes('purchase'))reply.header('Cache-Control','no-store').header('Referrer-Policy','no-referrer');});
 app.get('/api/v1/purchase-options',async()=>({productName:'远程学习',amounts:[10,20,50],ratio:1,reviewMinutes:10,qrCodeUrl:new URL('/xianyu-profile.jpg',config.PUBLIC_BASE_URL).href}));
 app.post('/api/v1/me/purchase-tickets',{config:{rateLimit:{max:12,timeWindow:'1 minute'}}},async req=>{
  const a=await actor(req,Boolean(req.headers.authorization));z.object({}).strict().parse(req.body??{});const secret=fresh();
  return db.transaction(async tx=>{
   await tx.select({id:users.id}).from(users).where(eq(users.id,a.user.id)).for('update');
   const [session]=a.web?await tx.select().from(webSessions).where(eq(webSessions.tokenHash,hashRefresh(req.cookies.bridge_session!))).limit(1):[];
   if(a.web&&!session)throw new ApiError(401,'UNAUTHORIZED');
   const scope=a.device?eq(purchaseTickets.deviceId,a.device.id):eq(purchaseTickets.webSessionId,session!.id);
   await tx.update(purchaseTickets).set({revokedAt:new Date()}).where(and(eq(purchaseTickets.userId,a.user.id),scope,isNull(purchaseTickets.claimId),isNull(purchaseTickets.revokedAt)));
   const [ticket]=await tx.insert(purchaseTickets).values({userId:a.user.id,deviceId:a.device?.id,deviceVersion:a.device?.authVersion,webSessionId:session?.id,tokenHash:hashRefresh(secret),expiresAt:new Date(Date.now()+lifetime)}).returning();
   // Remove only old ephemeral tickets; claims and financial history are retained.
   await tx.execute(sql`delete from purchase_tickets where id in (select id from purchase_tickets where expires_at < now()-interval '1 day' limit 500)`);
   return {id:ticket.id,url:`${config.PUBLIC_BASE_URL}/order-submit#ticket=${secret}`,expiresAt:ticket.expiresAt.toISOString(),maskedAccount:mask(a.user.email)};
  });
 });
 app.get('/api/v1/me/purchase-tickets/:id',async req=>{
  const a=await actor(req,Boolean(req.headers.authorization));const [ticket]=await db.select().from(purchaseTickets).where(and(eq(purchaseTickets.id,id(req.params)),eq(purchaseTickets.userId,a.user.id))).limit(1);if(!ticket)throw new ApiError(404,'NOT_FOUND');
  const [claim]=ticket.claimId?await db.select().from(purchaseClaims).where(and(eq(purchaseClaims.id,ticket.claimId),eq(purchaseClaims.userId,a.user.id))).limit(1):[];
  const state=claim?'SUBMITTED':ticket.revokedAt||ticket.expiresAt.getTime()<=Date.now()?'EXPIRED':'WAITING';return {state,claim:claim?publicClaim(claim):null};
 });
 app.get('/api/v1/me/purchase-claims',async req=>{
  const a=await actor(req,Boolean(req.headers.authorization));const {page,status}=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),status:z.enum(['all','PENDING','APPROVED','REJECTED']).default('all')}).parse(req.query);
  const where=and(eq(purchaseClaims.userId,a.user.id),status==='all'?undefined:eq(purchaseClaims.status,status));const [count]=await db.select({total:sql<number>`count(*)::integer`}).from(purchaseClaims).where(where);
  const rows=await db.select().from(purchaseClaims).where(where).orderBy(desc(purchaseClaims.createdAt)).limit(20).offset((page-1)*20);return {data:rows.map(publicClaim),total:Number(count.total),page,pageSize:20};
 });
 app.post('/api/v1/purchase-mobile/exchange',{config:{rateLimit:{max:30,timeWindow:'15 minutes'}}},async(req,reply)=>{
  origin(req);const {ticket:secret}=z.object({ticket:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict().parse(req.body);
  const result=await db.transaction(async tx=>{
   const [found]=await tx.select().from(purchaseTickets).where(eq(purchaseTickets.tokenHash,hashRefresh(secret))).limit(1);if(!found)throw expired();
   await tx.select({id:users.id}).from(users).where(eq(users.id,found.userId)).for('update');const [ticket]=await tx.select().from(purchaseTickets).where(eq(purchaseTickets.id,found.id)).for('update').limit(1);if(!ticket)throw expired();const user=await validTicket(tx,ticket);
   const existing=req.cookies[cookieName];if(ticket.mobileHash){if(!existing||hashRefresh(existing)!==ticket.mobileHash)throw new ApiError(409,'PURCHASE_LINK_USED','该二维码已在其他页面使用，请返回 Bridge 重新生成。');return {view:await mobileView(tx,ticket,user),secret:existing,expiresAt:ticket.expiresAt};}
   const mobile=fresh();await tx.update(purchaseTickets).set({mobileHash:hashRefresh(mobile)}).where(eq(purchaseTickets.id,ticket.id));return {view:await mobileView(tx,ticket,user),secret:mobile,expiresAt:ticket.expiresAt};
  });
  reply.header('Cache-Control','no-store').setCookie(cookieName,result.secret,{path:cookiePath,httpOnly:true,secure:new URL(config.PUBLIC_BASE_URL).protocol==='https:',sameSite:'strict',expires:result.expiresAt});return result.view;
 });
 app.get('/api/v1/purchase-mobile/status',async req=>db.transaction(async tx=>{const {ticket,user}=await mobileTicket(req,tx);return mobileView(tx,ticket,user);}));
 app.post('/api/v1/purchase-mobile/claims',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async req=>{
  origin(req);const {orderNo}=PurchaseClaimInputSchema.parse(req.body);
  return db.transaction(async tx=>{
   const {ticket,user}=await mobileTicket(req,tx,true);
   if(ticket.claimId){const [prior]=await tx.select().from(purchaseClaims).where(eq(purchaseClaims.id,ticket.claimId)).limit(1);if(prior.orderNo!==orderNo)throw new ApiError(409,'PURCHASE_LINK_USED','本链接已提交订单，请返回 Bridge 重新生成。');return {claim:publicClaim(prior),duplicate:true};}
   await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`purchase:${orderNo}`},0))`);
   let [claim]=await tx.select().from(purchaseClaims).where(eq(purchaseClaims.orderNo,orderNo)).for('update').limit(1);
   if(claim&&claim.userId!==user.id)throw new ApiError(409,'ORDER_ALREADY_SUBMITTED','该订单号已提交，请核对后重试。');
   const at=new Date();let duplicate=Boolean(claim);
   if(!claim){[claim]=await tx.insert(purchaseClaims).values({userId:user.id,orderNo,deadlineAt:new Date(at.getTime()+lifetime)}).returning();}
   else if(claim.status==='REJECTED'){[claim]=await tx.update(purchaseClaims).set({status:'PENDING',reason:null,points:null,reviewedAt:null,reviewedBy:null,attempt:claim.attempt+1,submittedAt:at,deadlineAt:new Date(at.getTime()+lifetime),updatedAt:at}).where(eq(purchaseClaims.id,claim.id)).returning();duplicate=false;}
   await tx.update(purchaseTickets).set({claimId:claim.id}).where(eq(purchaseTickets.id,ticket.id));
   if(!duplicate){await tx.insert(auditLogs).values({actorId:user.id,action:'PURCHASE_ORDER_SUBMITTED',targetType:'PURCHASE_CLAIM',targetId:claim.id,metadata:{attempt:claim.attempt,platform:'XIAN_YU'}});await enqueuePurchaseMail(tx,claim,user.email);}
   return {claim:publicClaim(claim),duplicate};
  });
 });
 app.get('/api/v1/admin/purchase-claims',async req=>{
  await admin(req);const {page,status,search}=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),status:z.enum(['all','PENDING','APPROVED','REJECTED']).default('PENDING'),search:z.string().trim().max(320).default('')}).parse(req.query);
  const where=and(status==='all'?undefined:eq(purchaseClaims.status,status),search?sql`(position(lower(${search}) in lower(${users.email}))>0 or position(${search} in ${purchaseClaims.orderNo})>0)`:undefined);
  const rows=await db.select({claim:purchaseClaims,email:users.email}).from(purchaseClaims).innerJoin(users,eq(users.id,purchaseClaims.userId)).where(where).orderBy(sql`case when ${purchaseClaims.status}='PENDING' then 0 else 1 end`,purchaseClaims.deadlineAt).limit(20).offset((page-1)*20);
  const [count]=await db.select({total:sql<number>`count(*)::integer`}).from(purchaseClaims).innerJoin(users,eq(users.id,purchaseClaims.userId)).where(where);
  const [summary]=await db.select({pending:sql<number>`count(*) filter(where status='PENDING')::integer`,overdue:sql<number>`count(*) filter(where status='PENDING' and deadline_at<now())::integer`,todayRmb:sql<number>`coalesce(sum(points) filter(where status='APPROVED' and (reviewed_at at time zone 'Asia/Shanghai')::date=(now() at time zone 'Asia/Shanghai')::date),0)/10000.0`}).from(purchaseClaims);
  return {data:rows.map(({claim,email})=>({...publicClaim(claim),email,userId:claim.userId})),total:Number(count.total),page,pageSize:20,summary:{pending:Number(summary.pending),overdue:Number(summary.overdue),todayRmb:Number(summary.todayRmb)}};
 });
 app.get('/api/v1/admin/purchase-claims/:id/reviews',async req=>{await admin(req);return {data:await db.select({id:purchaseReviews.id,status:purchaseReviews.status,points:purchaseReviews.points,reason:purchaseReviews.reason,createdAt:purchaseReviews.createdAt,reviewer:users.email}).from(purchaseReviews).innerJoin(users,eq(users.id,purchaseReviews.actorId)).where(eq(purchaseReviews.claimId,id(req.params))).orderBy(desc(purchaseReviews.createdAt)).limit(50)};});
 app.post('/api/v1/admin/purchase-claims/:id/review',async req=>{
  const a=await admin(req),claimId=id(req.params),body=PurchaseReviewSchema.parse(req.body);
  return db.transaction(async tx=>{
   const [claim]=await tx.select().from(purchaseClaims).where(eq(purchaseClaims.id,claimId)).for('update').limit(1);if(!claim)throw new ApiError(404,'NOT_FOUND');
   if(claim.status==='APPROVED'){if(body.status==='APPROVED'&&claim.points===paidRmbPoints(body.paidRmb))return {claim:publicClaim(claim),duplicate:true};throw new ApiError(409,'ORDER_ALREADY_REVIEWED','该订单已到账，不能重复处理。');}
   if(claim.status!=='PENDING')throw new ApiError(409,'ORDER_ALREADY_REVIEWED','该订单已处理，请刷新列表。');
   const [user]=await tx.select().from(users).where(eq(users.id,claim.userId)).limit(1);if(!user||user.status!=='ACTIVE')throw new ApiError(409,'ACCOUNT_DISABLED','该用户已停用，请先核对账号。');
   const at=new Date(),points=body.status==='APPROVED'?paidRmbPoints(body.paidRmb):null;let transactionId:string|undefined;
   if(points){await tx.select({id:referrals.id}).from(referrals).where(eq(referrals.referredUserId,claim.userId)).for('update');const added=await applyWalletChange(tx,{userId:claim.userId,points,type:'PURCHASE',referenceType:'PURCHASE_CLAIM',referenceId:claim.id,idempotencyKey:`purchase-claim:${claim.id}`,metadata:{source:'XIAN_YU',orderNo:claim.orderNo,reviewerId:a.user.id}});transactionId=added.transaction.id;}
   const [updated]=await tx.update(purchaseClaims).set({status:body.status,points,reason:body.reason||null,reviewedBy:a.user.id,reviewedAt:at,updatedAt:at}).where(eq(purchaseClaims.id,claim.id)).returning();
   if(transactionId)await qualifyInviteFromCredit(tx,claim.userId,{transactionId});
   await tx.insert(purchaseReviews).values({claimId:claim.id,actorId:a.user.id,status:body.status,points,reason:body.reason||null});
   await tx.insert(auditLogs).values({actorId:a.user.id,action:body.status==='APPROVED'?'PURCHASE_ORDER_CREDITED':'PURCHASE_ORDER_REJECTED',targetType:'PURCHASE_CLAIM',targetId:claim.id,metadata:{userId:claim.userId,points,reason:body.reason||null,attempt:claim.attempt}});
   await enqueuePurchaseMail(tx,updated,user.email);
   return {claim:publicClaim(updated),duplicate:false};
  });
 });
 app.get('/api/v1/me/purchase-notices',async req=>{
  const a=await actor(req,Boolean(req.headers.authorization));const rows=await db.select().from(purchaseClaims).where(and(eq(purchaseClaims.userId,a.user.id),sql`${purchaseClaims.status} in ('APPROVED','REJECTED')`,sql`${purchaseClaims.noticeAcknowledgedAttempt}<${purchaseClaims.attempt}`)).orderBy(purchaseClaims.reviewedAt).limit(20);return {data:rows.map(publicClaim)};
 });
 app.post('/api/v1/me/purchase-notices/:id/ack',async req=>{
  const a=await actor(req,Boolean(req.headers.authorization)),{attempt}=z.object({attempt:z.number().int().positive()}).strict().parse(req.body);
  const [row]=await db.update(purchaseClaims).set({noticeAcknowledgedAttempt:attempt}).where(and(eq(purchaseClaims.id,id(req.params)),eq(purchaseClaims.userId,a.user.id),eq(purchaseClaims.attempt,attempt),sql`${purchaseClaims.status} in ('APPROVED','REJECTED')`)).returning({id:purchaseClaims.id});if(!row)throw new ApiError(404,'NOT_FOUND');return {ok:true};
 });
 app.get('/api/v1/me/reward-notices',async req=>{const a=await actor(req,Boolean(req.headers.authorization));const rows=await db.select().from(rewardNotices).where(and(eq(rewardNotices.userId,a.user.id),isNull(rewardNotices.acknowledgedAt))).orderBy(rewardNotices.createdAt).limit(10);return {data:rows.map(row=>({id:row.id,amountRmb:row.points/10000,expiresAt:row.expiresAt.toISOString(),createdAt:row.createdAt.toISOString()}))};});
 app.post('/api/v1/me/reward-notices/:id/ack',async req=>{const a=await actor(req,Boolean(req.headers.authorization));z.object({}).strict().parse(req.body??{});const [row]=await db.update(rewardNotices).set({acknowledgedAt:sql`coalesce(acknowledged_at,now())`}).where(and(eq(rewardNotices.id,id(req.params)),eq(rewardNotices.userId,a.user.id))).returning({id:rewardNotices.id});if(!row)throw new ApiError(404,'NOT_FOUND');return {ok:true};});

}
