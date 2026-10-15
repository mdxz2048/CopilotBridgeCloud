import {db,systemSettings} from '@bridge/db';
import {eq} from 'drizzle-orm';
import {z} from 'zod';
export const EngagementSchema=z.object({revision:z.number().int().nonnegative(),campaign:z.object({enabled:z.boolean()}).strict(),notices:z.array(z.object({id:z.uuid(),text:z.string().trim().min(1).max(160),enabled:z.boolean()}).strict()).max(10)}).strict().refine(value=>new Set(value.notices.map(n=>n.id)).size===value.notices.length,{message:'通知标识不能重复'});
export type Engagement=z.infer<typeof EngagementSchema>;
export const defaultEngagement:Engagement={revision:0,campaign:{enabled:false},notices:[]};
export async function engagementPolicy(source:Pick<typeof db,'select'>=db):Promise<Engagement>{const [row]=await source.select().from(systemSettings).where(eq(systemSettings.key,'engagement')).limit(1);return row?EngagementSchema.parse(row.value):defaultEngagement;}
export function publicEngagement(policy:Engagement){return {inviteCampaign:policy.campaign.enabled?{id:'invite-welcome-5',referrerRmb:5,referredRmb:5,rewardDays:7,accountNeverExpires:true,rules:`活动期间通过邀请注册的新账号，首次充值（当前由管理员增加余额）后双方各得 ¥5 奖励余额；注册本身不发奖励。账号长期有效；双方奖励自到账起 7 天有效，正常余额不受本活动到期规则影响。异常邀请需核对。`}:null,announcements:[...(policy.campaign.enabled?[{id:'invite-welcome-5',text:'邀友首次充值各得 ¥5，奖励 7 天有效',action:'INVITE' as const}]:[]),...policy.notices.filter(n=>n.enabled).map(n=>({id:n.id,text:n.text,action:'NONE' as const}))]};}
