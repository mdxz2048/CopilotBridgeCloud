import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import nodemailer from 'nodemailer';
import {db,purchaseMailOutbox,type purchaseClaims} from '@bridge/db';
import {and,eq,lt,sql} from 'drizzle-orm';
import type {DbTransaction} from './wallet.js';
import {effectiveWebsiteSettings} from './website-settings.js';
import {config} from './config.js';

export const PURCHASE_ADMIN_EMAIL='zhipeng2048@gmail.com';
type Claim=typeof purchaseClaims.$inferSelect;
const at=(value:Date)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'medium',hour12:false}).format(value)+'（北京时间）';
export function purchaseMailMessages(claim:Claim,email:string,baseUrl=config.PUBLIC_BASE_URL){
 const link=new URL('/login',baseUrl);link.searchParams.set('reviewOrder',claim.orderNo);
 const lines=[`订单号：${claim.orderNo}`,`用户：${email}`,`第 ${claim.attempt} 次提交`,`提交时间：${at(claim.submittedAt)}`];
 if(claim.status==='PENDING')return [{kind:'ADMIN_SUBMITTED',recipient:PURCHASE_ADMIN_EMAIL,subject:'【Copilot Bridge】有订单等待审核',body:[...lines,'',`请登录管理员账号核对付款并审核：${link.href}`,'点击链接只打开审核页面，不会自动通过。请勿直接回复本邮件审批。'].join('\n')}];
 const approved=claim.status==='APPROVED',result=approved?`审核通过，已到账 ¥${((claim.points??0)/10000).toFixed(2)}`:'审核未通过';
 const body=[...lines,`审核结果：${result}`,`审核时间：${at(claim.reviewedAt!)}`,...(claim.reason?[`审核说明：${claim.reason}`]:[])].join('\n');
 return [{kind:'ADMIN_REVIEWED',recipient:PURCHASE_ADMIN_EMAIL,subject:`【Copilot Bridge】订单${approved?'已审核到账':'已拒绝'}回执`,body:body+`\n\n查看订单：${link.href}`},
 {kind:'USER_REVIEWED',recipient:email,subject:`【Copilot Bridge】你的订单${approved?'已到账':'审核未通过'}`,body:body+'\n\n'+(approved?'余额已更新，可返回 Copilot Bridge 继续使用。':'请核对订单号和付款情况，必要时重新提交。')+`\n账号中心：${new URL('/dashboard',baseUrl).href}`}];
}
export async function enqueuePurchaseMail(tx:DbTransaction,claim:Claim,email:string){
 for(const message of purchaseMailMessages(claim,email))await tx.insert(purchaseMailOutbox).values({claimId:claim.id,attempt:claim.attempt,...message}).onConflictDoNothing();
}
type Sender=(message:{to:string;subject:string;text:string;messageId:string})=>Promise<void>;
export async function deliverPurchaseMail(send?:Sender){
 let sent=0,failed=0;
 for(let i=0;i<10;i++){
  const token=randomUUID();
  const item=await db.transaction(async tx=>{
   const [row]=await tx.select().from(purchaseMailOutbox).where(sql`${purchaseMailOutbox.status}='PENDING' and ${purchaseMailOutbox.nextAttemptAt}<=now() and (${purchaseMailOutbox.lockedUntil} is null or ${purchaseMailOutbox.lockedUntil}<now())`).orderBy(purchaseMailOutbox.createdAt).for('update',{skipLocked:true}).limit(1);
   if(!row)return null;
   await tx.update(purchaseMailOutbox).set({leaseToken:token,lockedUntil:new Date(Date.now()+120000),deliveryAttempts:row.deliveryAttempts+1}).where(eq(purchaseMailOutbox.id,row.id));return row;
  });
  if(!item)break;
  try{
   const message={to:item.recipient,subject:item.subject,text:item.body,messageId:`<purchase-${item.id}@${new URL(config.PUBLIC_BASE_URL).hostname}>`};
   if(send)await send(message);else{
    const {email}=await effectiveWebsiteSettings();if(!email.smtpHost||!email.smtpUser||!email.password||!email.from)throw new Error('SMTP_NOT_CONFIGURED');
    const mailer=nodemailer.createTransport({host:email.smtpHost,port:email.smtpPort,secure:[465,2465].includes(email.smtpPort),requireTLS:![465,2465].includes(email.smtpPort),auth:{user:email.smtpUser,pass:email.password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000});
    try{const result=await mailer.sendMail({from:email.from,...message});if(!result.accepted?.length||result.rejected?.length)throw new Error('SMTP_REJECTED');}finally{mailer.close();}
   }
   await db.update(purchaseMailOutbox).set({status:'SENT',sentAt:new Date(),leaseToken:null,lockedUntil:null,lastError:null,body:''}).where(and(eq(purchaseMailOutbox.id,item.id),eq(purchaseMailOutbox.leaseToken,token)));sent++;
  }catch{
   const attempts=item.deliveryAttempts+1;
   await db.update(purchaseMailOutbox).set({status:attempts>=10?'FAILED':'PENDING',nextAttemptAt:new Date(Date.now()+Math.min(6*3600000,30000*2**Math.min(attempts,10))),lastError:'DELIVERY_FAILED',leaseToken:null,lockedUntil:null}).where(and(eq(purchaseMailOutbox.id,item.id),eq(purchaseMailOutbox.leaseToken,token)));failed++;
  }
 }
 return {sent,failed};
}
export function registerPurchaseMailWorker(app:FastifyInstance){
 if(process.env.NODE_ENV==='test')return;
 let running:Promise<unknown>|undefined,stopped=false;
 const tick=()=>{if(stopped||running)return;running=(async()=>{const result=await deliverPurchaseMail();if(result.failed)app.log.warn({event:'purchase_mail_delivery_failed',count:result.failed},'order mail queued for retry');await db.delete(purchaseMailOutbox).where(and(sql`${purchaseMailOutbox.status}<>'PENDING'`,lt(purchaseMailOutbox.createdAt,new Date(Date.now()-30*86400000))));})().catch(()=>app.log.warn({event:'purchase_mail_worker_failed'},'order mail worker will retry')).finally(()=>{running=undefined;});};
 app.addHook('onReady',async()=>{tick();});const timer=setInterval(tick,15000);timer.unref();app.addHook('onClose',async()=>{stopped=true;clearInterval(timer);await running;});
}
