import {test,expect} from '@playwright/test';
import {emptyCatalogInput,emptyOfferInput} from '../lib/growth-catalog';
import {emptyMissionInput} from '../lib/growth-mission';
// Real local D1/UI/API with synthetic authenticated owner; no external requests.
test('성장 공유재고·실제 주문 품목·출고·정산 재조회',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`ops-${info.project.name}-${Date.now()}`}}),page=await context.newPage();
 try{
  await page.request.get('/api/workspace');
  const sr=await page.request.post('/api/stores',{data:{action:'save_store',brandId:'ofd',data:{name:'이행 합성 지점',address:'합성 주소',tradeArea:'residential',goal:'품목 이행'}}});expect(sr.status()).toBe(200);const {id:storeId}=await sr.json();
  const title=`주문 재고 ${info.project.name}`,cr=await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'합성 이행 검증'}}});expect(cr.status()).toBe(200);const {id:campaignId}=await cr.json();
  const save=async(action:string,id:string,input:unknown)=>{const r=await page.request.post('/api/growth',{data:{action,id,input,campaignId,campaignVersion:1,expectedVersion:0}});expect(r.status(),await r.text()).toBe(200)};
  await save('save_catalog','ops-catalog',{...emptyCatalogInput(),title:'합성 상품',sku:'OPS-SKU'});
  await save('save_offer','ops-offer',{...emptyOfferInput(),title:'합성 오퍼',catalogId:'ops-catalog',catalogVersion:1});
  await save('save_mission','ops-mission',{...emptyMissionInput(),title:'이행 연결 미션',offerId:'ops-offer',offerVersion:1});
  const or=await page.request.post('/api/store-operations',{data:{action:'save_order',storeId,data:{source:'direct',orderNumber:'OPS-ORDER',orderDate:new Date().toISOString().slice(0,10),mode:'delivery',status:'paid',paidAmount:10000,refundAmount:0,channel:'unknown'}}});expect(or.status(),await or.text()).toBe(200);
  const {ids:[orderId]}=await or.json();
  await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'성장·판매',exact:true}).click();
  await page.locator('summary').filter({hasText:'주문·재고·이행 운영'}).click();
  const panel=page.getByRole('region',{name:'주문 재고 이행 운영',exact:true});
  await panel.locator('summary').filter({hasText:'공유 재고 등록·실사·입고'}).click();
  const stock=panel.getByRole('group',{name:'공유 재고 등록',exact:true});
  await stock.getByRole('combobox',{name:'SKU',exact:true}).fill('OPS-SKU');await stock.getByLabel('처음 확인한 실물 수량 (미확인은 빈칸)',{exact:true}).fill('5');await stock.getByLabel('증빙 내부 ID (개인정보 제외)',{exact:true}).fill('warehouse-1');await stock.getByRole('button',{name:'공유 재고 등록',exact:true}).click();await expect(panel.getByRole('status')).toContainText('공유 재고를 등록했습니다.');
  await panel.locator('summary').filter({hasText:'주문 품목과 판매 미션 연결'}).click();const link=panel.getByRole('group',{name:'주문 품목과 판매 미션',exact:true});
  await link.getByRole('combobox',{name:'지점 주문',exact:true}).selectOption(orderId);await link.getByRole('combobox',{name:'연결 판매 미션',exact:true}).selectOption('ops-mission');await link.getByRole('combobox',{name:'SKU가 일치하는 공유 재고',exact:true}).selectOption({index:1});await link.getByLabel('주문 품목 수량',{exact:true}).fill('2');
  for(const [name,value] of [['판매 계정 내부 ID','seller'],['원 주문 품목 ID','line-a'],['품목 연결 증빙 참조 (개인정보 제외)','seller-line-a'],['이 품목에 배분할 결제액 (원, 미확인은 빈칸)','10000'],['이 품목에 배분할 환불액 (원, 미확인은 빈칸)','0']])await link.getByLabel(name,{exact:true}).fill(value);
  await link.getByRole('button',{name:'주문 품목 연결 저장',exact:true}).click();await expect(panel.getByRole('status')).toContainText('주문 품목을 연결했습니다.');
  await panel.locator('summary').filter({hasText:'출고·환불·반품·예약 해제 기록'}).click();const operation=panel.getByRole('group',{name:'이행 사건 기록',exact:true});
  await operation.getByRole('combobox',{name:'이행할 주문 품목',exact:true}).selectOption({index:1});await operation.getByLabel('사건 수량 (개)',{exact:true}).fill('1');await operation.getByLabel('증빙 내부 ID (개인정보 제외)',{exact:true}).fill('warehouse-ship-1');await operation.getByRole('button',{name:'이행 사건 저장',exact:true}).click();await expect(panel.getByRole('status')).toContainText('이행 사건을 기록했습니다.');
  const read=async()=>{const r=await page.request.get(`/api/growth/operations?campaignId=${campaignId}`);expect(r.status()).toBe(200);return r.json()};let v=await read();expect(v.inventory[0].projection.onHand).toBe(4);expect(v.inventory[0].projection.reserved).toBe(1);
  await panel.locator('summary').filter({hasText:'지급예정·입금 증빙과 수령 현금'}).click();
  const cash=panel.getByRole('region',{name:'지급예정과 입금 증빙',exact:true});await cash.getByRole('button',{name:'새 입금 확인',exact:true}).click();
  await cash.getByRole('combobox',{name:'연결 주문',exact:true}).selectOption(orderId);
  for(const [name,value] of [['정산 계정 내부 참조','seller'],['정산 묶음 내부 참조','batch-a'],['개별 지급예정·입금 참조','receipt-a'],['이 입금에서 수령한 금액 (원, 미확인은 빈칸)','9500'],['이 증빙에 기재된 수수료 (원, 미확인은 빈칸)','500'],['정산 증빙 내부 참조','statement-a']])await cash.getByLabel(name,{exact:true}).fill(value);
  await cash.getByRole('button',{name:'정산 증빙 저장',exact:true}).click();await expect(panel.getByRole('status')).toContainText('정산 증빙을 저장했습니다.');
  await expect(cash).toContainText('9,500원');v=await read();expect(v.settlement.ledgerNetRevenue).toBe(10000);expect(v.settlement.receivedCash.total).toBe(9500);expect(v.settlement.netCashFlow).toBeNull();
  await cash.getByLabel('이 입금에서 수령한 금액 (원, 미확인은 빈칸)',{exact:true}).fill('9400');await cash.getByRole('button',{name:'같은 사건의 수정판 저장',exact:true}).click();
  await panel.getByRole('button',{name:'운영 기록 새로고침',exact:true}).click();await expect(cash).toContainText('9,400원');v=await read();expect(v.settlement.events).toHaveLength(1);expect(v.settlement.events[0].revision).toBe(2);expect(v.settlement.receivedCash.total).toBe(9400);
  expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);const box=await panel.boundingBox();expect(box).not.toBeNull();expect(box!.x+box!.width).toBeLessThanOrEqual((page.viewportSize()?.width??1280)+1);await cash.getByRole('heading',{name:'지급예정·입금 증빙',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:`e2e/artifacts/growth-operations-${info.project.name}.png`});
 }finally{await context.close()}
});
