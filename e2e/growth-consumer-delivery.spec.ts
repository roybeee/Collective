import {test,expect} from '@playwright/test';
// Actual local ledger/Chromium; response-loss injected after commit. No provider connection or sends.
test('소비자 발송 대기 응답 유실을 재조회로 복구하고 같은 요청을 중복 생성하지 않음',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`delivery-${info.project.name}-${Date.now()}`}}),page=await context.newPage();
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};await page.request.get('/api/workspace');
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'발송 합성 지점',address:'합성 주소',tradeArea:'residential',goal:'발송 원장'}});
  const title=`발송 원장 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'동의 기반 발송 검증'}});
  const {ids:[orderId]}=await post('/api/store-operations',{action:'save_order',storeId,data:{source:'direct',orderNumber:'DELIVERY-1',orderDate:new Date().toISOString().slice(0,10),mode:'delivery',status:'paid',paidAmount:1000,refundAmount:0,channel:'unknown'}});
  const created=await post('/api/growth/consumer',{action:'create_customer',campaignId,campaignVersion:1,expectedVersion:0,requestId:crypto.randomUUID()}),customerId=created.resultCustomerId;
  let version=1;
  for(const purpose of ['identity_link','post_purchase']){await post('/api/growth/consumer',{action:'set_consent',campaignId,campaignVersion:1,customerId,expectedVersion:version++,requestId:crypto.randomUUID(),purpose,state:'granted',noticeVersion:'notice-v1',evidenceRef:'proof-v1',observedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()})}
  await post('/api/growth/consumer',{action:'link_order',campaignId,campaignVersion:1,customerId,expectedVersion:version,requestId:crypto.randomUUID(),orderId,orderVersion:1,evidenceRef:'order-link'});
  await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'성장·판매',exact:true}).click();await page.locator('summary').filter({hasText:/^소비자 동의·재구매 검토$/}).click();
  const panel=page.getByRole('region',{name:'소비자 발송 원장',exact:true});await expect(panel).toContainText('발송 연결: 비활성');
  await panel.getByRole('combobox',{name:'발송 고객',exact:true}).selectOption(customerId);await panel.getByLabel('불변 템플릿 UUID',{exact:true}).fill(crypto.randomUUID());await panel.getByLabel('템플릿 SHA-256',{exact:true}).fill('a'.repeat(64));await panel.getByLabel('발송 만료(UTC ISO)',{exact:true}).fill(new Date(Date.now()+3600000).toISOString());await panel.getByLabel('위임 ID',{exact:true}).fill('owner-grant');
  await panel.getByLabel('템플릿 SHA-256',{exact:true}).fill('invalid');await panel.getByRole('button',{name:'발송 대기 저장',exact:true}).click();await expect(panel.getByRole('status')).toContainText('최신 원장을 조회한 뒤');await expect(panel.getByRole('button',{name:'이전 대기 등록 재시도',exact:true})).toHaveCount(0);await panel.getByRole('button',{name:'최신 원장 조회',exact:true}).click();await panel.getByLabel('템플릿 SHA-256',{exact:true}).fill('a'.repeat(64));
  let drop=true;await page.route('**/api/growth/consumer-delivery',async route=>{if(route.request().method()==='POST'&&drop){drop=false;await route.fetch();await route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'합성 응답 유실'})})}else await route.continue()});
  await panel.getByRole('button',{name:'발송 대기 저장',exact:true}).click();await expect(panel.getByRole('status')).toContainText('최신 원장을 조회한 뒤');await expect(panel.getByRole('button',{name:'발송 대기 저장',exact:true})).toBeDisabled();
  await panel.getByRole('button',{name:'이전 대기 등록 재시도',exact:true}).click();await expect(panel.getByRole('status')).toContainText('저장했습니다');
  const read=async()=>{const r=await page.request.get('/api/growth/consumer-delivery?campaignId='+campaignId);return r.json()};expect((await read()).deliveries).toHaveLength(1);await expect(panel.getByRole('button',{name:'이전 대기 등록 재시도',exact:true})).toHaveCount(0);
  await panel.getByRole('button',{name:'자동 실행 승인',exact:true}).click();const approval=page.getByRole('alertdialog');await expect(approval).toContainText('1회 발송');await approval.getByRole('button',{name:'취소',exact:true}).click();expect((await read()).deliveries[0].approval).toBeNull();
  await panel.getByRole('button',{name:'추가 발송 억제·취소 요청',exact:true}).click();await expect.poll(async()=>(await read()).deliveries[0].status).toBe('failed');await page.reload();expect((await read()).deliveries).toHaveLength(1);
 }finally{await context.close()}
});
