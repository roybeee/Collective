import {test,expect} from '@playwright/test';
// Real local D1 and Chromium; synthetic owner and signing keys. No provider requests.
test('판매처·소비자 연결은 꺼짐으로 저장되고 서명키를 다시 노출하지 않는다',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`provider-config-${info.project.name}-${Date.now()}`}}),page=await context.newPage();
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};await page.request.get('/api/workspace');
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'연결 합성 지점',address:'합성 주소',tradeArea:'residential',goal:'서명 연결'}});
  const title=`연결 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'설정 검증'}});
  const open=async()=>{await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'성장·판매',exact:true}).click()};
  await open();await page.locator('summary').filter({hasText:/^상세페이지 수정안·적용 확인$/}).click();
  const landing=page.getByRole('region',{name:'상세페이지 수정안',exact:true});await landing.locator('summary').filter({hasText:/^판매처 상품 설명 연결/}).click();
  await landing.getByLabel('판매처 tenant ID',{exact:true}).fill('e2e-tenant');await landing.getByLabel('판매처 store ID',{exact:true}).fill('e2e-store');
  const signingKey=crypto.randomUUID()+crypto.randomUUID();
  await landing.getByLabel(/^판매처 서명키/).fill(signingKey);await landing.getByRole('button',{name:'판매처 연결 저장',exact:true}).click();
  await expect(landing.getByRole('status').filter({hasText:'꺼짐 상태로 저장'})).toBeVisible();await expect(landing.getByLabel(/^판매처 서명키/)).toHaveValue('');
  const lr=await page.request.get(`/api/growth/landing?campaignId=${campaignId}`),lv=await lr.json();expect(lv.providerConnection.enabled).toBe(false);expect(JSON.stringify(lv)).not.toContain(signingKey);
  await page.locator('summary').filter({hasText:/^소비자 동의·재구매 검토$/}).click();const delivery=page.getByRole('region',{name:'소비자 발송 원장',exact:true});
  await delivery.locator('summary').filter({hasText:'소유자 발송 연결'}).click();await delivery.getByLabel('발송 테넌트 ID',{exact:true}).fill('e2e-tenant');await delivery.getByLabel('발송 제공자 매장 ID',{exact:true}).fill('e2e-store');await delivery.getByLabel('발송 서명 비밀값',{exact:true}).fill(signingKey);
  await delivery.getByRole('button',{name:'연결 비활성 저장',exact:true}).click();await expect(delivery.getByRole('status').filter({hasText:'저장했습니다'})).toBeVisible();await expect(delivery.getByLabel('발송 서명 비밀값',{exact:true})).toHaveValue('');
  const dr=await page.request.get(`/api/growth/consumer-delivery?campaignId=${campaignId}`),dv=await dr.json();expect(dv.connection.enabled).toBe(false);expect(JSON.stringify(dv)).not.toContain(signingKey);
  await open();await page.locator('summary').filter({hasText:/^소비자 동의·재구매 검토$/}).click();await expect(page.getByRole('region',{name:'소비자 발송 원장',exact:true})).toContainText('비활성');
  const before=new Date(Date.now()-60000).toISOString(),after=new Date(Date.now()+86400000).toISOString();
  const consent=(body:Record<string,unknown>)=>post('/api/growth/consumer',{campaignId,campaignVersion:1,expectedVersion:0,requestId:crypto.randomUUID(),...body});
  const created=await consent({action:'create_customer'}),customerId=created.resultCustomerId;
  for(const [purpose,expectedVersion] of [['identity_link',1],['post_purchase',2]] as const)await consent({action:'set_consent',customerId,expectedVersion,purpose,state:'granted',noticeVersion:'e2e-notice',evidenceRef:'e2e-consent',observedAt:before,expiresAt:after});
  const {ids:[orderId]}=await post('/api/store-operations',{action:'save_order',storeId,data:{source:'direct',orderNumber:'PROVIDER-E2E',orderDate:before.slice(0,10),mode:'delivery',status:'paid',paidAmount:1000,refundAmount:0,channel:'unknown'}});
  await consent({action:'link_order',customerId,expectedVersion:3,orderId,orderVersion:1,evidenceRef:'e2e-identity'});
  await post('/api/growth/authority',{action:'save_authority',id:'consumer-grant',campaignId,campaignVersion:1,expectedVersion:0,sign:true,input:{accountId:'e2e-tenant',channel:'consumer_delivery',status:'active',maxTier:'T2',allowedActions:['publish'],startsAt:before,expiresAt:after,periodStart:before,periodEnd:after,totalCap:1000,dayCap:1000,weekCap:1000,lossCap:1000}});
  await post('/api/growth/consumer-delivery',{action:'configure',campaignId,campaignVersion:1,expectedVersion:1,requestId:crypto.randomUUID(),config:{tenantId:'e2e-tenant',providerStoreId:'e2e-store',secret:'',enabled:true}});
  await open();await page.locator('summary').filter({hasText:/^소비자 동의·재구매 검토$/}).click();
  const queue=page.getByRole('region',{name:'소비자 발송 원장',exact:true});await queue.getByLabel('발송 고객',{exact:true}).selectOption(customerId);
  for(const [name,value] of [['불변 템플릿 UUID',crypto.randomUUID()],['템플릿 SHA-256','a'.repeat(64)],['발송 만료(UTC ISO)',after],['위임 ID','consumer-grant']])await queue.getByLabel(name,{exact:true}).fill(value);
  let sends=0;await page.route('**/api/growth/consumer-delivery',async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON().action==='queue'){sends++;await route.fetch();await route.abort('failed');return}await route.continue()});
  await queue.getByRole('button',{name:'발송 대기 저장',exact:true}).click();await expect(queue.getByRole('status')).toContainText('요청 결과를 확인하지 못했습니다');
  await queue.getByRole('button',{name:'최신 원장 조회',exact:true}).click();await expect(queue.getByRole('status')).toContainText('이전 대기 요청의 저장을 확인했습니다');
  const queued=await (await page.request.get(`/api/growth/consumer-delivery?campaignId=${campaignId}`)).json();expect(queued.deliveries).toHaveLength(1);expect(queued.deliveries[0].status).toBe('queued');expect(queued.deliveries[0].approval).toBeNull();expect(sends).toBe(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 }finally{await context.close()}
});
