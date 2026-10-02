import {test,expect} from '@playwright/test';
// Real local D1/API/Chromium. Only one response loss is injected; no storefront page is changed.
test('상세페이지 수정안·가격 차단·승인≠적용·운영자 적용/되돌림 영수증',async({browser},info)=>{
 const owner=`landing-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};await page.request.get('/api/workspace');
  const before=new Date(Date.now()-86400000).toISOString(),after=new Date(Date.now()+30*86400000).toISOString(),day=after.slice(0,10);
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'상세 합성 지점',address:'합성 주소',tradeArea:'residential',goal:'상세 개선'}});
  const title=`상세 개선 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'상세 개선'}});
  const {id:factId}=await post('/api/brand-facts',{action:'save_fact',confirmed:true,data:{brandId:'ofd',key:'배송 조건',value:'평일 당일 출고',status:'confirmed',source:'합성 운영 확인',verifiedAt:before,validUntil:after}});
  const save=(action:string,id:string,input:unknown)=>post('/api/growth',{action,id,input,campaignId,campaignVersion:1,expectedVersion:0});
  await save('save_catalog','landing-catalog',{sku:'LANDING-SKU',title:'상세 상품',price:12000,unitCost:4000,variableCost:1000,stock:0,stockUnit:'piece',currency:'KRW',taxBasis:'included',fulfillment:'배송 조건',refunds:'반품 조건',rightsConfirmed:true,factIds:[factId],validUntil:day});
  await save('save_offer','landing-offer',{title:'상세 오퍼',catalogId:'landing-catalog',catalogVersion:1,needId:'',price:12000,quantity:1,landingUrl:'https://example.com/buy',purchaseReason:'준비 단축',priceApproved:true});
  await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'성장·판매',exact:true}).click();
  await page.locator('summary').filter({hasText:/^상세페이지 수정안·적용 확인$/}).click();const panel=page.getByRole('region',{name:'상세페이지 수정안',exact:true});await expect(panel).toBeVisible({timeout:5000});
  await panel.getByRole('button',{name:'새 수정안',exact:true}).click();
  await panel.getByRole('textbox',{name:'수정안 제목',exact:true}).fill('배송 불안 해소');await panel.getByRole('combobox',{name:'판매 오퍼',exact:true}).selectOption('landing-offer');await expect(panel).toContainText('승인 가격 12,000원');
  await panel.getByRole('textbox',{name:'변경 이유',exact:true}).fill('배송 문의가 많음');await panel.getByRole('textbox',{name:'되돌림 기준',exact:true}).fill('이전 문구 복구');
  await panel.getByRole('combobox',{name:'구역 종류 1',exact:true}).selectOption('price_display');await panel.getByRole('textbox',{name:'현재 문구 1',exact:true}).fill('가격');await panel.getByRole('textbox',{name:'변경 문구 1',exact:true}).fill('오늘만 9,900원');
  await panel.getByRole('button',{name:'수정안 저장',exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'수정안을 저장했습니다'})).toBeVisible();
  await expect(panel).toContainText('가격 표시 문구는 승인된 오퍼 가격과 같아야 합니다.');const id=(await panel.locator('legend').filter({hasText:'수정안 landing-'}).innerText()).replace('수정안 ','').trim();
  await expect(panel.getByRole('button',{name:`${id} 승인`,exact:true})).toBeDisabled();
  await panel.getByRole('textbox',{name:'변경 문구 1',exact:true}).fill('12,000원');await panel.getByRole('button',{name:'구역 하나 더',exact:true}).click();
  await panel.getByRole('combobox',{name:'구역 종류 2',exact:true}).selectOption('shipping');await panel.getByRole('textbox',{name:'변경 문구 2',exact:true}).fill('평일 오후 2시 전 주문은 당일 출고');await panel.getByRole('listbox',{name:'확정 사실 근거 2',exact:true}).selectOption(factId);
  await panel.getByRole('button',{name:'수정안 저장',exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'수정안을 저장했습니다'})).toBeVisible();await expect(panel).not.toContainText('가격 표시 문구는 승인된');
  await panel.getByRole('button',{name:`${id} 승인`,exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'페이지는 아직 바뀌지 않았습니다'})).toBeVisible();await expect(panel).toContainText('페이지 변경: 확인되지 않음');
  const now=new Date(Date.now()+20000),local=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16);
  await panel.getByLabel('적용·되돌림 시각',{exact:true}).fill(local);await panel.getByRole('textbox',{name:'페이지 확인 증빙 ID',exact:true}).fill('page-check-1');
  const attempts:string[]=[];let lose=true;await page.route('**/api/growth/landing',async route=>{if(route.request().method()==='POST'){attempts.push(route.request().postDataJSON().requestId);if(lose){lose=false;await route.fetch();await route.abort('failed');return;}}await route.continue();});
  await panel.getByRole('button',{name:`${id} 적용 확인 기록`,exact:true}).click();await expect(panel.getByRole('alert')).toContainText('입력은 보존했습니다');
  await panel.getByRole('button',{name:`${id} 적용 확인 기록`,exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'적용 확인을 기록했습니다'})).toBeVisible();expect(attempts[0]).toBe(attempts[1]);
  await expect(panel).toContainText('페이지 변경: 운영자 확인');await expect(panel).toContainText('효과: 미측정');
  await panel.getByRole('textbox',{name:'되돌림 사유',exact:true}).fill('전환 하락');await panel.getByRole('button',{name:`${id} 되돌림 기록`,exact:true}).click();await expect(panel).toContainText('되돌림 확인');
  await panel.locator('summary').filter({hasText:'수정안 이력'}).click();await expect(panel).toContainText(`${id}, v5, 되돌림 확인`);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 }finally{await context.close()}
});
