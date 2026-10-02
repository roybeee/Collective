import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {emptyCatalogInput,emptyOfferInput} from '../lib/growth-catalog';
import {emptyMissionInput} from '../lib/growth-mission';
import {emptyDecisionInput} from '../lib/growth-decisions';
// Real local D1/API/Chromium. Only one response loss is injected.
test('반품 원인 → 일일 결정 연결·분포 분모·응답 유실 재시도·원인 개정 보류',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`cause-${info.project.name}-${Date.now()}`}}),page=await context.newPage();
 try{
  const post=async(url:string,data:unknown)=>{const r=await page.request.post(url,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};
  await page.request.get('/api/workspace');
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'원인 연결 지점',address:'합성 주소',tradeArea:'residential',goal:'원인 연결'}});
  const title=`원인 연결 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'원인 개선'}});
  const save=async(action:string,id:string,input:unknown)=>post('/api/growth',{action,id,input,campaignId,campaignVersion:1,expectedVersion:0});
  await save('save_catalog','cause-catalog',{...emptyCatalogInput(),title:'원인 상품',sku:'CAUSE-SKU',stockUnit:'piece'});
  await save('save_offer','cause-offer',{...emptyOfferInput(),title:'원인 오퍼',catalogId:'cause-catalog',catalogVersion:1});
  await save('save_mission','cause-mission',{...emptyMissionInput(),title:'원인 미션',offerId:'cause-offer',offerVersion:1});
  const {ids:[orderId]}=await post('/api/store-operations',{action:'save_order',storeId,data:{source:'direct',orderNumber:'CAUSE',orderDate:new Date().toISOString().slice(0,10),mode:'delivery',status:'paid',paidAmount:10000,refundAmount:0,channel:'unknown',campaignId,attributionEvidence:'운영자 확인'}});
  const stock=await post('/api/growth/operations',{action:'create_inventory',campaignId,campaignVersion:1,input:{sku:'CAUSE-SKU',locationId:storeId,unit:'piece',onHand:5},observedAt:new Date().toISOString(),evidenceRef:'count-sheet'});
  const linked=await post('/api/growth/operations',{action:'link_order',campaignId,campaignVersion:1,expectedVersion:0,inventoryVersion:stock.inventory[0].version,input:{orderId,orderVersion:1,sourceKey:'shop',accountId:'seller',externalLineId:'source-line',inventoryId:stock.inventory[0].id,units:2,missionId:'cause-mission',missionVersion:1,offerId:'cause-offer',offerVersion:1,paidAllocation:10000,refundAllocation:0,currency:'KRW',taxBasis:'included',evidenceRef:'line-check',source:'operator_attested'}});
  const lineId=linked.orderLines[0].id;
  const first=await post('/api/growth/operations',{action:'record_operation',campaignId,campaignVersion:1,id:'cause-refund',inventoryVersion:linked.inventory[0].version,lineId,kind:'refund',quantity:1,evidenceRef:'refund-evidence',observedAt:new Date().toISOString()});
  await post('/api/growth/operations',{action:'record_operation',campaignId,campaignVersion:1,id:'cause-refund-2',inventoryVersion:first.inventory[0].version,lineId,kind:'refund',quantity:1,evidenceRef:'refund-evidence-2',observedAt:new Date().toISOString()});
  const reason=async(eventId:string,code:string,expectedVersion:number)=>{const view=await (await page.request.get(`/api/growth/return-reasons?campaignId=${campaignId}`)).json(),e=view.events.find((x:{eventId:string})=>x.eventId===eventId);return post('/api/growth/return-reasons',{campaignId,campaignVersion:1,eventId,eventVersion:e.eventVersion,lineId,lineVersion:e.lineVersion,expectedVersion,requestId:randomUUID(),input:{reasonCode:code,evidenceRef:'case-'+eventId}})};
  await reason('cause-refund','product_defect',0);
  await post('/api/growth/decisions',{action:'save_decision',campaignId,campaignVersion:1,id:'cause-decision',expectedVersion:0,input:{...emptyDecisionInput(),title:'결함 대응 결정',missionId:'cause-mission',missionVersion:1}});
  await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'성장·판매',exact:true}).click();
  await page.locator('summary').filter({hasText:/^반품 원인 → 개선 검토 연결$/}).click();const panel=page.getByRole('region',{name:'반품 원인 개선 연결',exact:true});await expect(panel).toBeVisible({timeout:5000});
  await expect(panel).toContainText('분모: 반품·환불 사건이 있는 품목 1건');await expect(panel).toContainText('상품 결함: 1건');await expect(panel).toContainText('결함률·반품률이 아닌');
  await panel.getByRole('combobox',{name:'원인 기록된 사건',exact:true}).selectOption('cause-refund');await panel.getByRole('combobox',{name:'검토 종류',exact:true}).selectOption('decision');await panel.getByRole('combobox',{name:'검토 기록',exact:true}).selectOption('cause-decision');await panel.getByRole('textbox',{name:'연결 메모(개인정보 제외)',exact:true}).fill('결함 재발 방지 검토');
  const attempts:string[]=[];let lose=true;await page.route('**/api/growth/cause-links',async route=>{if(route.request().method()==='POST'){attempts.push(route.request().postDataJSON().requestId);if(lose){lose=false;await route.fetch();await route.abort('failed');return;}}await route.continue();});
  await panel.getByRole('button',{name:'원인 연결',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('입력은 보존했습니다');
  await panel.getByRole('button',{name:'원인 연결',exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'연결했습니다'})).toBeVisible();expect(attempts[0]).toBe(attempts[1]);
  await expect(panel).toContainText('cause-refund (상품 결함 v1) → 일일 결정 cause-decision v1, 현재');
  await reason('cause-refund','description_mismatch',1);await panel.getByRole('button',{name:'원인 연결 새로고침',exact:true}).click();await expect(panel).toContainText('연결 뒤 원인 기록이 개정되었습니다');
  await panel.getByRole('button',{name:'cause-refund→cause-decision 해제',exact:true}).click();await panel.locator('summary').filter({hasText:'원인 연결 이력'}).click();await expect(panel).toContainText('v2, 해제');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 }finally{await context.close()}
});
