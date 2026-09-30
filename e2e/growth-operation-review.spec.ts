import {test,expect} from '@playwright/test';
import {emptyCatalogInput,emptyOfferInput} from '../lib/growth-catalog';
import {emptyMissionInput} from '../lib/growth-mission';
// Real local D1/API/Chromium; only the final refresh failure is injected.
test('운영 확인 목록의 정확한 품목 이동·입력 보호·이전 조회 표시',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`review-${info.project.name}-${Date.now()}`}}),page=await context.newPage();
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
  const orderId=await order('LINKED',true),unlinked=await order('UNLINKED',true),foreign=await order('OUTSIDE',false);
  const stock=await post('/api/growth/operations',{action:'create_inventory',campaignId,campaignVersion:1,input:{sku:'REVIEW-SKU',locationId:storeId,unit:'piece',onHand:5},observedAt:new Date().toISOString(),evidenceRef:'count-sheet'});
  const inventory=stock.inventory[0];
  const linked=await post('/api/growth/operations',{action:'link_order',campaignId,campaignVersion:1,expectedVersion:0,inventoryVersion:inventory.version,input:{orderId,orderVersion:1,sourceKey:'shop',accountId:'seller',externalLineId:'source-line',inventoryId:inventory.id,units:2,missionId:'review-mission',missionVersion:1,offerId:'review-offer',offerVersion:1,paidAllocation:10000,refundAllocation:0,currency:'KRW',taxBasis:'included',evidenceRef:'line-check',source:'operator_attested'}});
  const lineId=linked.orderLines[0].id;
  await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'성장·판매',exact:true}).click();await page.locator('summary').filter({hasText:'주문·재고·이행 운영'}).click();
  const panel=page.getByRole('region',{name:'주문 재고 이행 운영',exact:true}),review=panel.getByRole('region',{name:'운영 확인 목록',exact:true});
  await expect(review).toBeVisible({timeout:5000});await expect(review).toContainText(unlinked);await expect(review).not.toContainText(foreign);await expect(review).toContainText('미출고 할당 2개');
  const row=review.getByRole('article',{name:`품목 ${lineId}`,exact:true});await row.getByRole('button',{name:'이행 기록 열기',exact:true}).click();
  const operation=panel.getByRole('group',{name:'이행 사건 기록',exact:true});await expect(operation.getByRole('combobox',{name:'이행할 주문 품목',exact:true})).toHaveValue(lineId);await expect(operation.getByRole('combobox',{name:'이행 종류',exact:true})).toHaveValue('');await expect(operation.getByLabel('사건 수량 (개)',{exact:true})).toHaveValue('');
  await operation.getByLabel('증빙 내부 ID (개인정보 제외)',{exact:true}).fill('keep-my-draft');await expect(row.getByRole('button')).toBeDisabled();await expect(operation.getByLabel('증빙 내부 ID (개인정보 제외)',{exact:true})).toHaveValue('keep-my-draft');await panel.getByRole('button',{name:'운영 입력 변경 취소',exact:true}).click();await expect(row.getByRole('button')).toBeEnabled();
  await review.getByRole('article',{name:`주문 ${unlinked}`,exact:true}).getByRole('button',{name:'품목 연결 열기',exact:true}).click();await expect(panel.getByRole('group',{name:'주문 품목과 판매 미션',exact:true}).getByRole('combobox',{name:'지점 주문',exact:true})).toHaveValue(unlinked);
  await page.route('**/api/growth/operations?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'합성 조회 실패'})}));await panel.getByRole('button',{name:'운영 기록 새로고침',exact:true}).click();await expect(review).toContainText('이전 조회');await expect(review).toContainText(lineId);await expect(row.getByRole('button')).toBeDisabled();
  expect(await review.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:`e2e/artifacts/growth-operation-review-${info.project.name}.png`});
 }finally{await context.close().catch(()=>{})}
});
