import {describe,it,expect} from 'vitest';
import {defaultEngagement,EngagementSchema,publicEngagement} from './engagement-policy.js';
const id='11111111-1111-4111-8111-111111111111';
describe('quiet announcements and signup promotion',()=>{
 it('advertises nothing unless enabled and never exposes disabled notices',()=>{
  expect(publicEngagement(defaultEngagement)).toEqual({inviteCampaign:null,announcements:[]});
  const next=publicEngagement({revision:1,campaign:{enabled:true},notices:[{id,text:'隐藏通知',enabled:false}]});
  expect(next.inviteCampaign).toMatchObject({referrerRmb:5,referredRmb:5,rewardDays:7,accountNeverExpires:true});expect(next.announcements).toHaveLength(1);expect(next.announcements[0].action).toBe('INVITE');
 });
 it('keeps active plain notices when the promotion is disabled',()=>{
  expect(publicEngagement({...defaultEngagement,notices:[{id,text:'服务已恢复',enabled:true}]}).announcements).toEqual([{id,text:'服务已恢复',action:'NONE'}]);
 });
 it('rejects ambiguous IDs, arbitrary links and obsolete account-expiry settings',()=>{
  expect(EngagementSchema.safeParse({...defaultEngagement,notices:[{id,text:'x',enabled:true},{id,text:'y',enabled:true}]}).success).toBe(false);
  expect(EngagementSchema.safeParse({...defaultEngagement,notices:[{id,text:'x',enabled:true,url:'https://other.invalid'}]}).success).toBe(false);
  expect(EngagementSchema.safeParse({...defaultEngagement,campaign:{enabled:true,trialDays:0}}).success).toBe(false);
 });
});
