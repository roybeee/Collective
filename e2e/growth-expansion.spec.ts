import {test,expect} from '@playwright/test';
import {seedCanonicalExpansion} from './helpers/canonical-expansion';
// Real local D1/API/Chromium; no external spend.
test('검증된 확대 제안·20% 차단·소유자 승인 예약·대사',async({browser},info)=>{
 const owner=`expansion-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};await page.request.get('/api/workspace');
  const before=new Date(Date.now()-86400000).toISOString(),after=new Date(Date.now()+30*86400000).toISOString(),day=after.slice(0,10);
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'확대 합성 지점',address:'합성 주소',tradeArea:'residential',goal:'확대'}});
  const title=`확대 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'확대'}});
  const {id:factId}=await post('/api/brand-facts',{action:'save_fact',confirmed:true,data:{brandId:'ofd',key:'합성 상품',value:'근거',status:'confirmed',source:'합성 운영 확인',verifiedAt:before,validUntil:after}});
  const save=(action:string,id:string,input:unknown)=>post('/api/growth',{action,id,input,campaignId,campaignVersion:1,expectedVersion:0});
  await save('save_signal','x-signal',{title:'근거',sourceUrl:'https://example.com/m',observedAt:before,expiresAt:day,sourceType:'market',summary:'관측',sampleSize:null});
  await save('save_need','x-need',{title:'니즈',situation:'상황',desiredOutcome:'결과',alternative:'대안',barrier:'장애',counterEvidence:'반례',signalIds:['x-signal'],deadline:day,nextAction:'검증',assignee:'담당'});
  await save('save_catalog','x-catalog',{sku:'X-SKU',title:'상품',price:100,unitCost:20,variableCost:10,stock:0,stockUnit:'piece',currency:'KRW',taxBasis:'included',fulfillment:'배송',refunds:'반품',rightsConfirmed:true,factIds:[factId],validUntil:day});
  await save('save_offer','x-offer',{title:'오퍼',catalogId:'x-catalog',catalogVersion:1,needId:'x-need',price:100,quantity:1,landingUrl:'https://example.com/buy',purchaseReason:'이유',priceApproved:true});
  await save('save_mission','x-mission',{title:'미션',offerId:'x-offer',offerVersion:1,assignee:'담당',deadline:day,nextAction:'판매',channel:'storefront',budget:1000,lossLimit:1000,stopRule:'한도',fulfillmentOwner:'배송'});
  await post('/api/growth/operations',{action:'create_inventory',campaignId,campaignVersion:1,input:{sku:'X-SKU',locationId:storeId,unit:'piece',onHand:50},observedAt:before,evidenceRef:'stock'});
  await post('/api/growth/authority',{action:'save_authority',id:'x-auth',campaignId,campaignVersion:1,expectedVersion:0,sign:true,input:{accountId:'acct',channel:'storefront',status:'active',maxTier:'T3',allowedActions:['publish','spend'],startsAt:before,expiresAt:after,periodStart:before,periodEnd:after,totalCap:10000,dayCap:10000,weekCap:10000,lossCap:10000}});
  await seedCanonicalExpansion({owner,campaignId,storeId,before,post});
  await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'성장·판매',exact:true}).click();
  await page.locator('summary').filter({hasText:/^검증된 확대·예산 예약$/}).click();const panel=page.getByRole('region',{name:'검증된 확대',exact:true});await expect(panel).toBeVisible({timeout:5000});
  await panel.getByRole('textbox',{name:'미션 ID',exact:true}).fill('x-mission');await panel.getByRole('textbox',{name:'실험 ID',exact:true}).fill('x-exp');await panel.getByRole('spinbutton',{name:'확대 후 예산(원)',exact:true}).fill('1500');await panel.getByRole('spinbutton',{name:'추가 판매 수량',exact:true}).fill('10');await panel.getByRole('textbox',{name:'확대 이유',exact:true}).fill('확증 개선');
  await panel.getByRole('button',{name:'확대 제안',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('20% 이내');
  await panel.getByRole('spinbutton',{name:'확대 후 예산(원)',exact:true}).fill('1200');await panel.getByRole('button',{name:'확대 제안',exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'아직 예약되지 않았습니다'})).toBeVisible();
  await expect(panel).toContainText('증가분 200원');const id=(await panel.locator('li strong').first().innerText()).trim();
  const approve=panel.getByRole('button',{name:`${id} 소유자 승인·예약`,exact:true});// 활성 위임이 하나뿐이면 미리 골라 둔다.
  await expect(panel.getByRole('combobox',{name:'예약에 쓸 활성 위임',exact:true})).toHaveValue('x-auth');
  await approve.click();await expect(panel.getByRole('status').filter({hasText:'확대 예산을 예약했습니다'})).toBeVisible();await expect(panel).toContainText('확대 예약 200원, 원장 reserved');
  await panel.getByRole('spinbutton',{name:'누적 실비(원)',exact:true}).fill('180');await panel.getByRole('spinbutton',{name:'누적 손실(원)',exact:true}).fill('20');await panel.getByRole('textbox',{name:'대사 증빙 ID',exact:true}).fill('settle-1');await panel.getByRole('textbox',{name:'대사 근거',exact:true}).fill('정산 확인');await panel.getByLabel('잔여 의무 없음 확인').check();
  await panel.getByRole('button',{name:`${id} 대사 기록`,exact:true}).click();await expect(panel).toContainText('원장 reconciled, 실비 180원, 손실 20원');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 }finally{await context.close()}
});
