import type {GrowthReturnReasonView} from '../lib/growth-return-reasons-server';
import {test,expect} from '@playwright/test';
import {emptyCatalogInput,emptyOfferInput} from '../lib/growth-catalog';
import {emptyMissionInput} from '../lib/growth-mission';
// Real local D1/API/Chromium; only the final refresh failure is injected.
test('반품 환불 원인·응답 유실 재시도·충돌 입력 보존',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`reasons-${info.project.name}-${Date.now()}`}}),page=await context.newPage();
 try{
  const post=async(url:string,data:unknown)=>{const r=await page.request.post(url,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};
  await page.request.get('/api/workspace');
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'운영 확인 지점',address:'합성 주소',tradeArea:'residential',goal:'운영 확인'}});
  const title=`운영 확인 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'정확한 품목 확인'}});
  const save=async(action:string,id:string,input:unknown)=>post('/api/growth',{action,id,input,campaignId,campaignVersion:1,expectedVersion:0});
  await save('save_catalog','review-catalog',{...emptyCatalogInput(),title:'확인 상품',sku:'REVIEW-SKU',stockUnit:'piece'});
  await save('save_offer','review-offer',{...emptyOfferInput(),title:'확인 오퍼',catalogId:'review-catalog',catalogVersion:1});
  await save('save_mission','review-mission',{...emptyMissionInput(),title:'확인 미션',offerId:'review-offer',offerVersion:1});
  const order=async(orderNumber:string,assigned:boolean)=>{const r=await post('/api/store-operations',{action:'save_order',storeId,data:{source:'direct',orderNumber,orderDate:new Date().toISOString().slice(0,10),mode:'delivery',status:'paid',paidAmount:10000,refundAmount:0,channel:'unknown',...(assigned?{campaignId,attributionEvidence:'운영자 확인'}:{})}});return r.ids[0] as string};
  const orderId=await order('LINKED',true);
  const stock=await post('/api/growth/operations',{action:'create_inventory',campaignId,campaignVersion:1,input:{sku:'REVIEW-SKU',locationId:storeId,unit:'piece',onHand:5},observedAt:new Date().toISOString(),evidenceRef:'count-sheet'});
  const inventory=stock.inventory[0];
  const linked=await post('/api/growth/operations',{action:'link_order',campaignId,campaignVersion:1,expectedVersion:0,inventoryVersion:inventory.version,input:{orderId,orderVersion:1,sourceKey:'shop',accountId:'seller',externalLineId:'source-line',inventoryId:inventory.id,units:2,missionId:'review-mission',missionVersion:1,offerId:'review-offer',offerVersion:1,paidAllocation:10000,refundAllocation:0,currency:'KRW',taxBasis:'included',evidenceRef:'line-check',source:'operator_attested'}});
  const lineId=linked.orderLines[0].id;
  const record=async(id:string,inventoryVersion:number)=>post('/api/growth/operations',{action:'record_operation',campaignId,campaignVersion:1,id,inventoryVersion,lineId,kind:'refund',quantity:1,evidenceRef:'refund-evidence',observedAt:new Date().toISOString()});
  const first=await record('refund-one',linked.inventory[0].version);await record('refund-two',first.inventory[0].version);
  await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'성장·판매',exact:true}).click();
  await expect(page.locator('summary').filter({hasText:'반품·환불 원인'})).toBeVisible({timeout:5000});await page.locator('summary').filter({hasText:'반품·환불 원인'}).click();
  const panel=page.getByRole('region',{name:'반품 환불 원인',exact:true}),events=panel.getByRole('combobox',{name:'기록할 반품·환불 사건',exact:true}),reason=panel.getByRole('combobox',{name:'운영자가 확인한 원인',exact:true}),evidence=panel.getByLabel('원인 증빙 내부 ID (개인정보 제외)',{exact:true});
  await events.selectOption('refund-one');await expect(panel).toContainText(lineId);await expect(panel).toContainText('사건 기록 수량 1개');await evidence.fill('evidence-one');
  const attempts:string[]=[];let lose=true;await page.route('**/api/growth/return-reasons',async route=>{if(route.request().method()==='POST'){attempts.push(route.request().postDataJSON().requestId);if(lose){lose=false;await route.fetch();await route.abort('failed');return;}}await route.continue();});
  await panel.getByRole('button',{name:'원인 기록 저장',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('입력은 보존');await expect(evidence).toHaveValue('evidence-one');await panel.getByRole('button',{name:'원인 기록 저장',exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'원인 기록을 저장했습니다'})).toBeVisible();expect(attempts[0]).toBe(attempts[1]);
  await panel.getByRole('button',{name:'현재 입력을 유지하고 최신 판 채택',exact:true}).click();await evidence.fill('draft-to-keep');
  const read=async():Promise<GrowthReturnReasonView>=>{const r=await page.request.get(`/api/growth/return-reasons?campaignId=${campaignId}`);expect(r.status()).toBe(200);return r.json()};const v=await read(),event=v.events.find(e=>e.eventId==='refund-one')!;
  await post('/api/growth/return-reasons',{campaignId,campaignVersion:v.campaignVersion,eventId:event.eventId,eventVersion:event.eventVersion,lineId:event.lineId,lineVersion:event.lineVersion,expectedVersion:event.current!.version,requestId:crypto.randomUUID(),input:{reasonCode:'other',evidenceRef:'concurrent-note'}});
  await panel.getByRole('button',{name:'원인 기록 저장',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('판');await expect(evidence).toHaveValue('draft-to-keep');await panel.getByRole('button',{name:'원인 목록 새로고침',exact:true}).click();await expect(evidence).toHaveValue('draft-to-keep');await panel.getByRole('button',{name:'현재 입력을 유지하고 최신 판 채택',exact:true}).click();await reason.selectOption('product_defect');await panel.getByRole('button',{name:'원인 기록 저장',exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'원인 기록을 저장했습니다'})).toBeVisible();
  await events.selectOption('refund-two');await expect(evidence).toHaveValue('');await expect(reason).toHaveValue('unknown');const final=await read();expect(final.events.find(e=>e.eventId==='refund-one')!.current!.input.reasonCode).toBe('product_defect');expect(final.history.filter(r=>r.eventId==='refund-one')).toHaveLength(3);
  await evidence.fill('second-event-note');await page.route('**/api/growth/return-reasons?*',route=>route.fulfill({status:503,json:{error:'합성 조회 실패'}}));await panel.getByRole('button',{name:'원인 기록 저장',exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'원인 기록을 저장했습니다'})).toBeVisible();await expect(panel).toContainText('이전 조회 결과');await expect(panel.getByRole('button',{name:'원인 기록 저장',exact:true})).toBeDisabled();await page.unroute('**/api/growth/return-reasons?*');await panel.getByRole('button',{name:'원인 목록 새로고침',exact:true}).click();await expect(panel).toContainText('저장 원인 v1: 미확인');
  expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await panel.scrollIntoViewIfNeeded();await page.screenshot({path:`e2e/artifacts/growth-return-reasons-${info.project.name}.png`});
 }finally{await context.close().catch(()=>{})}
});
