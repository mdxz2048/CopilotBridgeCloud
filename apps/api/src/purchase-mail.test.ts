import {it,expect,vi} from 'vitest';
import type {purchaseClaims} from '@bridge/db';
vi.mock('./config.js',()=>({config:{PUBLIC_BASE_URL:'https://bridge.example.test'}}));
vi.mock('./website-settings.js',()=>({effectiveWebsiteSettings:vi.fn()}));
import {purchaseMailMessages,PURCHASE_ADMIN_EMAIL} from './purchase-mail.js';
const claim={orderNo:'ORDER-123456',attempt:1,status:'PENDING',submittedAt:new Date('2026-10-26T06:00:00Z'),reviewedAt:new Date('2026-10-26T06:05:00Z'),points:202500,reason:null} as typeof purchaseClaims.$inferSelect;
it('links to authenticated order review and distinguishes admin receipts from user results',()=>{
 const [pending]=purchaseMailMessages(claim,'user@example.test');expect(pending.recipient).toBe(PURCHASE_ADMIN_EMAIL);expect(pending.body).toContain('https://bridge.example.test/login?reviewOrder=ORDER-123456');expect(pending.body).toContain('北京时间');expect(pending.body).not.toContain('token=');
 const approved=purchaseMailMessages({...claim,status:'APPROVED'},'user@example.test');expect(approved).toHaveLength(2);expect(approved[1]).toMatchObject({recipient:'user@example.test',kind:'USER_REVIEWED'});expect(approved[1].body).toContain('¥20.25');
 const rejected=purchaseMailMessages({...claim,status:'REJECTED',reason:'请核对订单号'},'user@example.test');expect(rejected[1].body).toContain('请核对订单号');expect(rejected[1].body).not.toContain('已到账');
});
