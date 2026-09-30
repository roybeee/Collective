import {test,expect} from '@playwright/test';
import {emptyLessonInput} from '../lib/growth-decisions';
// Real local D1/API/Chromium. No automatic application, promotion or retirement.
test('재사용 교훈 적용 제안·적용 기록·결과 회수',async({browser},info)=>{
 const owner=`lesson-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};await page.request.get('/api/workspace');
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'교훈 합성 지점',address:'합성 주소',tradeArea:'residential',goal:'교훈'}});
  const title=`교훈 적용 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'교훈'}});
  const g=(action:string,id:string,input:unknown)=>post('/api/growth',{action,id,input,campaignId,campaignVersion:1,expectedVersion:0});
  await g('save_catalog','l-cat',{sku:'L-SKU',title:'상품',price:1000,unitCost:300,variableCost:100,stock:0,stockUnit:'piece',currency:'KRW',taxBasis:'included',fulfillment:'배송',refunds:'반품',rightsConfirmed:true,factIds:[],validUntil:'2099-01-01'});
  await g('save_offer','l-offer',{title:'오퍼',catalogId:'l-cat',catalogVersion:1,needId:'',price:1000,quantity:1,landingUrl:'https://example.com/p',purchaseReason:'이유',priceApproved:true});
  for(const m of ['l-m1','l-m2'])await g('save_mission',m,{title:m+' 미션',offerId:'l-offer',offerVersion:1,assignee:'담당',deadline:'2099-01-01',nextAction:'판매',channel:'storefront',budget:0,lossLimit:0,stopRule:'한도',fulfillmentOwner:'배송'});
  await post('/api/growth/decisions',{action:'save_lesson',id:'l-les',campaignId,campaignVersion:1,expectedVersion:0,input:{...emptyLessonInput(),title:'배송 안내 교훈',method:'배송 안내 검토',hypothesis:'안내가 문의를 줄임',scope:'국내 신규 주문',falsificationRule:'문의 증가 시 폐기',lossLimit:0,sourceType:'execution',evidenceLevel:'operational_observation',missionId:'l-m1',missionVersion:1,sourceEvidence:'주문별 집계',counterEvidence:'고객군 변화',expiresAt:'2099-10-31',state:'reusable',outcome:'success',testPlan:'문의 비교',testResult:'감소',nextAction:'재시험',assignee:'운영',dueAt:'2099-09-30'}});
  await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'성장·판매',exact:true}).click();
  await page.locator('summary').filter({hasText:/^운영 교훈 적용·결과$/}).click();const panel=page.getByRole('region',{name:'교훈 적용 계보',exact:true});await expect(panel).toBeVisible({timeout:5000});
  await panel.locator('li').filter({hasText:'l-m2 미션'}).getByRole('button',{name:'배송 안내 교훈 적용 준비'}).click();await expect(panel.getByRole('textbox',{name:'대상 ID',exact:true})).toHaveValue('l-m2');
  await panel.getByRole('textbox',{name:'적용 방법',exact:true}).fill('배송 안내 문구 추가');await panel.getByRole('textbox',{name:'확인할 결과',exact:true}).fill('배송 문의 감소');await panel.getByLabel('효과 확인일',{exact:true}).fill('2099-02-01');
  await panel.getByRole('button',{name:'적용 기록',exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'교훈 적용을 기록했습니다'})).toBeVisible();await expect(panel).toContainText('→ 판매 미션 l-m2 v1');await expect(panel).toContainText('결과 대기');
  const apply=(await panel.locator('li').filter({hasText:'→ 판매 미션 l-m2'}).first().innerText()).split(' · ')[0].trim();
  await panel.getByRole('button',{name:`${apply} 결과 기록`,exact:true}).click();await panel.getByRole('combobox',{name:'결과',exact:true}).selectOption('failure');await panel.getByRole('textbox',{name:'결과 증빙 ID',exact:true}).fill('ev-1');await panel.getByRole('textbox',{name:'결과 근거',exact:true}).fill('문의 감소 없음');
  await panel.getByRole('button',{name:'결과 저장',exact:true}).click();await expect(panel).toContainText('적용 1 · 성공 0 · 실패 1');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 }finally{await context.close()}
});
