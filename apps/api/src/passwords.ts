import { randomBytes, createHmac } from 'node:crypto';
import { db, users, devices, refreshTokens, webSessions, passwordResets, auditLogs } from '@bridge/db';
import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { actor, ApiError } from './core.js';
import { config } from './config.js';
import { hashPassword, verifyPassword } from './security.js';
import { effectiveWebsiteSettings } from './website-settings.js';
import { verifyTurnstile } from './registration.js';

export const NewPasswordSchema = z.string().min(12).max(128);
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const digest = (value: string) => createHmac('sha256', config.REFRESH_TOKEN_PEPPER).update(`password-reset:${value}`).digest('hex');

// Caller holds the user lock. Invalidate access JWTs as well as refresh tokens/cookies.
export async function replacePassword(tx: Tx, userId: string, passwordHash: string, actorId: string, action: string) {
  await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
  await tx.update(devices).set({ authVersion: sql`${devices.authVersion} + 1`,
    status: sql`case when ${devices.status} = 'BLOCKED' then 'BLOCKED' else 'REVOKED' end`, updatedAt: new Date() }).where(eq(devices.userId, userId));
  await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  await tx.update(webSessions).set({ revokedAt: new Date() }).where(and(eq(webSessions.userId, userId), isNull(webSessions.revokedAt)));
  await tx.update(passwordResets).set({ state: 'USED' }).where(and(eq(passwordResets.userId, userId), eq(passwordResets.state, 'ISSUED')));
  await tx.insert(auditLogs).values({ actorId, action, targetType: 'USER', targetId: userId });
}

export async function requestPasswordReset(email: string, ip: string) {
  const { email: mail } = await effectiveWebsiteSettings();
  if (!mail.smtpHost || !mail.smtpUser || !mail.password || !mail.from) throw new ApiError(503, 'EMAIL_DELIVERY_UNAVAILABLE');
  const emailHash = digest(`email:${email}`), ipHash = digest(`ip:${ip}`), token = randomBytes(32).toString('base64url');
  const now = new Date();
  const reserved = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ipHash},0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${emailHash},0))`);
    const [quota] = await tx.select({ total: sql<number>`count(*)`, recent: sql<number>`count(*) filter (where ${passwordResets.createdAt} > ${new Date(Date.now()-60000)})` })
      .from(passwordResets).where(and(eq(passwordResets.emailHash,emailHash),gte(passwordResets.createdAt,new Date(Date.now()-3600000))));
    const [ipQuota] = await tx.select({ total: sql<number>`count(*)` }).from(passwordResets)
      .where(and(eq(passwordResets.ipHash,ipHash),gte(passwordResets.createdAt,new Date(Date.now()-3600000))));
    if (Number(quota.total)>=3 || Number(quota.recent)>0 || Number(ipQuota.total)>=8) throw new ApiError(429,'RATE_LIMITED');
    const [user] = await tx.select().from(users).where(eq(users.email,email)).limit(1);
    const eligible = user?.status === 'ACTIVE';
    const [row] = await tx.insert(passwordResets).values({ userId: eligible?user.id:null, emailHash,ipHash,
      tokenHash: digest(token), passwordSnapshot: eligible?digest(user.passwordHash):null,
      state: eligible?'PENDING':'SUPPRESSED',expiresAt:new Date(now.getTime()+30*60000) }).returning();
    await tx.delete(passwordResets).where(lt(passwordResets.createdAt,new Date(Date.now()-7*86400000)));
    return row;
  });
  if (!reserved.userId) return;
  const implicitTls = mail.smtpPort===465 || mail.smtpPort===2465;
  const transport = nodemailer.createTransport({ host:mail.smtpHost,port:mail.smtpPort,secure:implicitTls,requireTLS:!implicitTls,
    auth:{user:mail.smtpUser,pass:mail.password},connectionTimeout:5000,greetingTimeout:5000,socketTimeout:10000 });
  try {
    const link = `${config.PUBLIC_BASE_URL}/reset-password#token=${token}`;
    const delivery = await transport.sendMail({ from:{name:'Copilot Bridge 账号服务',address:mail.from},to:email,
      subject:'【Copilot Bridge】重置登录密码',text:`你好：\n\n我们收到了你的密码重置申请。请打开以下链接设置新密码：\n${link}\n\n链接在 30 分钟内有效，且只能使用一次。重置后，所有已登录设备都需要重新登录。\n如果不是你本人申请，请忽略此邮件，你的密码不会改变。\n\nCopilot Bridge 账号服务` });
    if (!delivery.accepted?.some((v:unknown)=>typeof v==='string'&&v.toLowerCase()===email)) throw new Error('Delivery rejected');
    await db.update(passwordResets).set({state:'ISSUED'}).where(eq(passwordResets.id,reserved.id));
  } catch {
    await db.update(passwordResets).set({state:'FAILED'}).where(eq(passwordResets.id,reserved.id));
    throw new ApiError(503,'EMAIL_DELIVERY_UNAVAILABLE');
  }
}

export function registerPasswordRoutes(app: FastifyInstance) {
  app.post('/api/v1/auth/forgot-password',{config:{rateLimit:{max:8,timeWindow:'1 hour'}}},async(req,reply)=>{
    if(req.headers.origin!==config.PUBLIC_BASE_URL)throw new ApiError(403,'CSRF_REJECTED');
    const body=z.object({email:z.email().transform(v=>v.toLowerCase()),turnstileToken:z.string().max(4096).optional()}).parse(req.body);
    await verifyTurnstile(body.turnstileToken,'password_reset',req.ip);
    await requestPasswordReset(body.email,req.ip);
    return reply.header('Cache-Control','no-store').code(202).send({accepted:true});
  });
  app.post('/api/v1/auth/reset-password',{config:{rateLimit:{max:10,timeWindow:'15 minutes'}}},async(req,reply)=>{
    if(req.headers.origin!==config.PUBLIC_BASE_URL)throw new ApiError(403,'CSRF_REJECTED');
    const body=z.object({token:z.string().regex(/^[A-Za-z0-9_-]{43}$/),password:NewPasswordSchema}).parse(req.body);
    const [candidate]=await db.select({userId:passwordResets.userId}).from(passwordResets).where(eq(passwordResets.tokenHash,digest(body.token))).limit(1);
    if(!candidate?.userId)throw new ApiError(400,'PASSWORD_RESET_INVALID');
    const passwordHash=await hashPassword(body.password);
    await db.transaction(async tx=>{
      const [user]=await tx.select().from(users).where(eq(users.id,candidate.userId!)).for('update').limit(1);
      const [reset]=await tx.select().from(passwordResets).where(eq(passwordResets.tokenHash,digest(body.token))).for('update').limit(1);
      if(!user||user.status!=='ACTIVE'||!reset||reset.state!=='ISSUED'||reset.expiresAt<=new Date()||reset.passwordSnapshot!==digest(user.passwordHash))throw new ApiError(400,'PASSWORD_RESET_INVALID');
      await replacePassword(tx,user.id,passwordHash,user.id,'PASSWORD_RECOVERED');
    });
    reply.clearCookie('bridge_session',{path:'/'});
    return reply.header('Cache-Control','no-store').send({ok:true});
  });
  app.post('/api/v1/auth/change-password',{config:{rateLimit:{max:10,timeWindow:'15 minutes'}}},async(req,reply)=>{
    const a=await actor(req);
    const body=z.object({currentPassword:z.string().max(128),password:NewPasswordSchema}).parse(req.body);
    const passwordHash=await hashPassword(body.password);
    await db.transaction(async tx=>{
      const [user]=await tx.select().from(users).where(eq(users.id,a.user.id)).for('update').limit(1);
      if(!user||user.passwordHash!==a.user.passwordHash||!(await verifyPassword(user.passwordHash,body.currentPassword)))throw new ApiError(400,'CURRENT_PASSWORD_INVALID');
      if(body.password===body.currentPassword)throw new ApiError(400,'PASSWORD_UNCHANGED');
      await replacePassword(tx,user.id,passwordHash,user.id,'PASSWORD_CHANGED');
    });
    reply.clearCookie('bridge_session',{path:'/'});
    return reply.header('Cache-Control','no-store').send({ok:true});
  });
}
