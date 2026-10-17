import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
const base=process.env.ACCOUNT_BASE_URL??'http://127.0.0.1:3128',output=process.env.ACCOUNT_EVIDENCE_DIR;
const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[];
try {
 if(output)await mkdir(output,{recursive:true});
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:1000}});
  await context.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{if(window.__clipboardFail)throw Error('denied');window.__copied=text;}}}));
  let revoked=false,clearCalls=0,clearFailure=true,billFailure=false;
  const device={id:'11111111-1111-4111-8111-111111111111',deviceId:'22222222-2222-5222-8222-222222222222',deviceName:'工作电脑',platform:'Windows',appVersion:'0.3.21',status:'ACTIVE',lastSeenAt:'2026-10-17T06:00:00Z',activatedAt:'2026-10-01T00:00:00Z'};
  const data=Array.from({length:23},(_,i)=>({id:`bill-${i}`,category:i===0?'CONSUMPTION':'BALANCE',type:i===0?'USAGE_INTERVAL':i===1?'EXPIRATION':'ADMIN_ADJUSTMENT',points:i===0?-24800:i===1?-1000:500000,balanceAfter:i===0?null:900000+i*500000,occurredAt:'2026-10-17T06:00:00Z',startedAt:i===0?'2026-10-16T10:00:00Z':null,endedAt:i===0?'2026-10-17T06:00:00Z':null,deviceName:i===0?'工作电脑':null,deviceId:i===0?device.deviceId:null,periodKind:i===0?'SESSION':null}));
  await context.route('**/api/v1/**',async route=>{
   const path=new URL(route.request().url()).pathname;let body={},status=200;
   if(path.endsWith('/auth/me')){body=revoked?{error:{code:'UNAUTHORIZED',message:'请登录'}}:{user:{id:'fixture',email:'bill-preview@example.test',role:'USER'}};if(revoked)status=401;}
   else if(path==='/api/v1/account')body={user:{id:'fixture',email:'bill-preview@example.test',role:'USER',status:'ACTIVE'},plan:{maxDevices:3},subscription:{status:'ACTIVE'},devices:[device,{...device,id:'blocked',deviceName:'旧电脑',status:'BLOCKED'}]};
   else if(path.endsWith('/me/wallet'))body={balance:847826,regularBalance:797826,rewardBalance:50000};
   else if(path.endsWith('/referral/stats'))body={code:'INVITE8',registered:3};
   else if(path.endsWith('/me/bills')){
    if(billFailure){status=503;body={error:{code:'INTERNAL_ERROR',message:'fixture error'}};}
    else {const url=new URL(route.request().url()),kind=url.searchParams.get('kind'),page=Number(url.searchParams.get('page')??1);const rows=data.filter(r=>kind==='recharge'?r.category==='BALANCE'&&r.points>0:kind==='consumption'?r.category==='CONSUMPTION':true);body={data:rows.slice((page-1)*20,page*20),pending:kind==='recharge'?[]:[{id:'pending',deviceId:device.deviceId,deviceName:'工作电脑',startedAt:'2026-10-17T06:00:00Z'}],page,pageSize:20,total:rows.length,summary:{balance:847826,totalAdded:1000000,totalConsumed:184261}};}
   } else if(path.endsWith('/me/devices/revoke-all')){clearCalls++;assert.deepEqual(route.request().postDataJSON(),{confirm:true});if(clearFailure){status=503;body={error:{code:'INTERNAL_ERROR',message:'fixture failure'}};}else{revoked=true;body={ok:true,revokedDevices:1,webSessionsRevoked:true};}}
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/dashboard');
  await page.getByRole('heading',{name:'我的账号',exact:true}).waitFor();
  await page.getByRole('button',{name:'充值',exact:true}).click();
  await page.getByRole('dialog',{name:'联系管理员充值'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.account-topup-qr').naturalWidth>0);
  await page.getByRole('button',{name:'复制邮箱',exact:true}).click();assert.equal(await page.evaluate(()=>window.__copied),'bill-preview@example.test');
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
  await page.getByRole('button',{name:'复制邀请文案和链接'}).click();
  const copied=await page.evaluate(()=>window.__copied);assert.ok(copied.includes('原生 ChatGPT / Codex 体验'));assert.ok(copied.includes('/register?ref=INVITE8'));assert.equal(copied.split('\n').length,3);
  await page.evaluate(()=>window.__clipboardFail=true);await page.getByRole('button',{name:'复制邀请文案和链接'}).click();await page.getByText('复制失败，请选中下方邀请内容手动复制。',{exact:true}).waitFor();await page.evaluate(()=>window.__clipboardFail=false);
  await page.getByRole('button',{name:'账单',exact:true}).click();await page.getByRole('tab',{name:'全部',exact:true}).waitFor();await page.locator('.billing-loading').waitFor({state:'hidden'});
  assert.equal(await page.locator('.billing-table tbody tr').count(),21);
  await page.getByRole('button',{name:'下一页',exact:true}).click();await page.locator('.billing-loading').waitFor({state:'hidden'});assert.equal(await page.locator('.billing-table tbody tr').count(),3);
  await page.getByRole('tab',{name:'充值',exact:true}).click();await page.locator('.billing-loading').waitFor({state:'hidden'});assert.equal(await page.locator('.billing-table .pending').count(),0);assert.equal(await page.locator('.billing-table tbody tr').count(),20);
  await page.getByRole('tab',{name:'消耗',exact:true}).click();await page.locator('.billing-loading').waitFor({state:'hidden'});assert.equal(await page.locator('.billing-table tbody tr').count(),2);assert.ok((await page.locator('.billing-table').innerText()).includes('¥2.4800'));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(output)await page.screenshot({path:`${output}/account-bills-${width}.png`,fullPage:true});
  billFailure=true;await page.getByRole('button',{name:'刷新',exact:true}).click();await page.getByRole('alert').filter({hasText:'账单加载失败'}).waitFor();billFailure=false;await page.getByRole('button',{name:'重试',exact:true}).click();await page.locator('.billing-error').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'我的账号',exact:true}).click();await page.getByRole('button',{name:'清空全部登录设备',exact:true}).click();
  await page.getByRole('dialog',{name:'清空全部登录设备？'}).waitFor();assert.ok((await page.getByRole('dialog').innerText()).includes('包括当前网页'));
  if(output)await page.screenshot({path:`${output}/account-clear-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(clearCalls,0);
  await page.getByRole('button',{name:'清空全部登录设备',exact:true}).click();await page.getByRole('button',{name:'确认清空并退出'}).click();await page.getByText('清空失败，设备列表未改变，请重试。',{exact:true}).waitFor();assert.equal(await page.locator('.account-device-row').count(),2);
  clearFailure=false;await page.getByRole('button',{name:'确认清空并退出'}).click();await page.waitForURL('**/login');assert.equal(clearCalls,2);
  checks.push(`${width}px: topup QR + email copy, invitation text/ref copy + failure fallback, bill tabs/pagination/error retry, no overflow, clear cancel/failure/retry/logout`);
  await context.close();
 }
 assert.deepEqual(errors,[]);
 const report={date:'2026-10-17',base,checks,rendererErrors:errors,identity:'synthetic browser fixtures',allWritesIntercepted:true,realAccountsOrFundsChanged:false};
 if(output)await writeFile(output+'/account-review.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
