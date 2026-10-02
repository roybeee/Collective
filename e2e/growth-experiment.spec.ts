import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// Real local D1/API/Chromium. Time passage is simulated by rewriting the stored start/end; one response loss is injected.
function run(sql:string){const folder=mkdtempSync(join(tmpdir(),'collective-experiment-'));try{const path=join(folder,'q.sql');writeFileSync(path,sql);execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config','dist/server/wrangler.json','--local','--persist-to','e2e/.state','--file',path],{stdio:'pipe'});}finally{rmSync(folder,{recursive:true,force:true})}}
test('판매 실험 사전등록·설계 동결·배정·관측·표본 부족 판정',async({browser},info)=>{
 const owner=`experiment-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};await page.request.get('/api/workspace');
  const day=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'실험 합성 지점',address:'합성 주소',tradeArea:'residential',goal:'실험'}});
  const title=`판매 실험 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'실험'}});
  const save=(action:string,id:string,input:unknown)=>post('/api/growth',{action,id,input,campaignId,campaignVersion:1,expectedVersion:0});
  await save('save_catalog','exp-catalog',{sku:'EXP-SKU',title:'실험 상품',price:10000,unitCost:3000,variableCost:1000,stock:0,stockUnit:'piece',currency:'KRW',taxBasis:'included',fulfillment:'배송',refunds:'반품',rightsConfirmed:true,factIds:[],validUntil:day});
  await save('save_offer','exp-offer',{title:'실험 오퍼',catalogId:'exp-catalog',catalogVersion:1,needId:'',price:10000,quantity:1,landingUrl:'https://example.com/buy',purchaseReason:'이유',priceApproved:true});
  await save('save_mission','exp-mission',{title:'실험 미션',offerId:'exp-offer',offerVersion:1,assignee:'담당',deadline:day,nextAction:'판매',channel:'storefront',budget:0,lossLimit:0,stopRule:'한도',fulfillmentOwner:'배송'});
  await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'성장·판매',exact:true}).click();
  await page.locator('summary').filter({hasText:/^판매 실험·사전등록·분석$/}).click();const panel=page.getByRole('region',{name:'판매 실험',exact:true});await expect(panel).toBeVisible({timeout:5000});
  await panel.getByRole('button',{name:'새 실험 설계',exact:true}).click();const id=(await panel.locator('legend').filter({hasText:/^실험 exp-/}).innerText()).replace('실험 ','').trim();
  await panel.getByRole('textbox',{name:'실험 제목',exact:true}).fill('배송 문구 실험');await panel.getByRole('textbox',{name:'가설',exact:true}).fill('배송 문구가 구매를 늘린다');
  await panel.getByRole('textbox',{name:'미션 ID',exact:true}).fill('exp-mission');await panel.getByRole('textbox',{name:'오퍼 ID',exact:true}).fill('exp-offer');
  await panel.getByRole('textbox',{name:'개입 설명',exact:true}).fill('배송 문구 교체');await panel.getByRole('textbox',{name:'개입 근거(줄마다 종류:ID:판)',exact:true}).fill('offer:exp-offer:1');
  await panel.getByRole('spinbutton',{name:'군별 최소 표본',exact:true}).fill('10');await panel.getByRole('textbox',{name:'중단 기준',exact:true}).fill('손실 한도');
  await panel.getByRole('button',{name:'실험 설계 저장',exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'실험 설계를 저장했습니다'})).toBeVisible();
  const attempts:string[]=[];let lose=true;await page.route('**/api/growth/experiments',async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON().action==='register'){attempts.push(route.request().postDataJSON().requestId);if(lose){lose=false;await route.fetch();await route.abort('failed');return;}}await route.continue();});
  await panel.getByRole('button',{name:`${id} 사전등록`,exact:true}).click();await expect(panel.getByRole('alert')).toContainText('입력은 보존했습니다');
  await panel.getByRole('button',{name:'실험 새로고침',exact:true}).click();await expect(panel).toContainText('사전등록');await expect(panel.getByRole('button',{name:`${id} 설계 수정`,exact:true})).toHaveCount(0);
  const key=`${owner}:growth_experiment:${id}`,past=new Date(Date.now()-3600000).toISOString();
  run(`UPDATE records SET data=json_set(data,'$.input.startAt','${past}') WHERE id='${key}';`);await panel.getByRole('button',{name:'실험 새로고침',exact:true}).click();
  await panel.getByRole('textbox',{name:'배정할 가명 단위 키(줄마다 하나)',exact:true}).fill(['visitor-aaaa1','visitor-aaaa2','visitor-aaaa3','visitor-aaaa4'].join('\n'));await panel.getByRole('button',{name:`${id} 단위 배정`,exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'배정했습니다'})).toBeVisible();
  await expect(panel).toContainText(/배정: 대조 \d, 처리 \d, 관측 0/);
  const unit=panel.getByRole('combobox',{name:'관측할 배정 단위',exact:true});const first=await unit.locator('option').nth(1).getAttribute('value');await unit.selectOption(first!);await panel.getByRole('textbox',{name:'관측 근거 ID',exact:true}).fill('obs-1');
  await panel.getByRole('button',{name:`${id} 관측 기록`,exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'관측을 기록했습니다'})).toBeVisible();await expect(panel).toContainText(/관측 1/);
  await panel.getByRole('button',{name:`${id} 분석`,exact:true}).click();await expect(panel.getByRole('alert')).toContainText('관측 기간 중');
  run(`UPDATE records SET data=json_set(data,'$.input.endAt','${new Date(Date.now()-60000).toISOString()}','$.input.maturityDays',0) WHERE id='${key}';`);await panel.getByRole('button',{name:'실험 새로고침',exact:true}).click();
  await panel.getByRole('button',{name:`${id} 분석`,exact:true}).click();await expect(panel).toContainText('분석 1회차: 표본 부족');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 }finally{await context.close()}
});
