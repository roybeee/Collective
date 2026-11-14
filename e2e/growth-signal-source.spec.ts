import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// 로컬 D1 fixture(e2e/trust-ui.spec.ts와 같은 방식): API가 만들지 않는 모양의 자료 id를 넣을 때만 쓴다.
const quote=(value:string)=>`'${value.replaceAll("'","''")}'`;
function runSql(sql:string){
 const folder=mkdtempSync(join(tmpdir(),'collective-signal-'));
 try{const path=join(folder,'fixture.sql');writeFileSync(path,sql);execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config','dist/server/wrangler.json','--local','--persist-to','e2e/.state','--file',path],{stdio:'pipe'})}finally{rmSync(folder,{recursive:true,force:true})}
}
const record=(owner:string,kind:string,id:string,parent:string,data:unknown)=>`INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(${[`${owner}:${kind}:${id}`,owner,kind,parent,JSON.stringify(data),new Date().toISOString()].map(quote).join(',')}) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;`;

test('확정 Archive 시장자료 가져오기·판 충돌·응답 유실·중복 방지',async({browser},info)=>{
 const owner=`signal-source-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  const post=async(path:string,data:unknown)=>{const response=await page.request.post(path,{data});expect(response.status(),await response.text()).toBe(200);return response.json()};await page.request.get('/api/workspace');const title=`시장자료 연결 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title,goal:'확정 자료 재사용'}});
  const sourceTitle='공개 시장 관측',observedAt=new Date(Date.now()-86400000).toISOString(),expiresAt=new Date(Date.now()+30*86400000).toISOString().slice(0,10),{id:sourceId}=await post('/api/archive',{action:'add_source',brandId:'ofd',data:{title:sourceTitle,category:'market',url:'https://example.com/market',content:'공개 자료에서 간편 조리 선호를 관측했습니다.',scope:'공개 웹 자료',observedAt}});await post('/api/archive',{action:'review_source',brandId:'ofd',id:sourceId,version:1,status:'confirmed'});
  const {id:heldId}=await post('/api/archive',{action:'add_source',brandId:'ofd',data:{title:'기한 검토용 자료',category:'market',url:'https://example.com/other',content:'검토 대기 공개 관측',scope:'공개 웹 자료',observedAt}});
  const open=async()=>{await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'성장·판매',exact:true}).click();/* 근거가 있으면 빈 첫 단계에서 열리므로 시장 근거 단계를 고른다. */await page.getByRole('navigation',{name:'성장 작업 단계'}).getByRole('button',{name:'시장 근거',exact:true}).click();const panel=page.getByRole('region',{name:'확정 시장자료 가져오기',exact:true});await expect(panel).toBeVisible({timeout:5000});return panel};
  const panel=await open(),choice=panel.getByRole('combobox',{name:'브랜드 아카이브 자료 선택',exact:true}),expiry=panel.getByLabel('가져올 근거 유효기한',{exact:true});await choice.selectOption(sourceId);await expect(panel).toContainText('공개 자료에서 간편 조리 선호를 관측했습니다.');await expiry.fill(expiresAt);await choice.selectOption(heldId);await expect(expiry).toHaveValue('');await expect(panel.getByRole('button',{name:'시장 근거로 가져오기',exact:true})).toBeDisabled();await choice.selectOption(sourceId);await expiry.fill(expiresAt);
  await post('/api/archive',{action:'review_source',brandId:'ofd',id:sourceId,version:2,status:'confirmed'});await panel.getByRole('button',{name:'시장 근거로 가져오기',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('입력은 보존했습니다.');await panel.getByRole('button',{name:'자료 목록 새로고침',exact:true}).click();await expect(expiry).toHaveValue(expiresAt);await panel.getByRole('button',{name:'현재 기한을 유지하고 최신 자료 판 사용',exact:true}).click();
  const attempts:string[]=[];let lose=true;await page.route('**/api/growth/signal-sources',async route=>{if(route.request().method()==='POST'){attempts.push(route.request().postDataJSON().requestId);if(lose){lose=false;const response=await route.fetch();expect(response.status(),await response.text()).toBe(200);await route.abort('failed');return;}}await route.continue();});await panel.getByRole('button',{name:'시장 근거로 가져오기',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('입력은 보존했습니다.');await panel.getByRole('button',{name:'시장 근거로 가져오기',exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'시장 근거를 가져왔습니다.'})).toContainText('시장 근거를 가져왔습니다.');expect(attempts).toHaveLength(2);expect(attempts[0]).toBe(attempts[1]);await expect(panel.getByRole('button',{name:'시장 근거로 가져오기',exact:true})).toBeDisabled();await expect(page.getByRole('group',{name:'시장 근거 기록 목록',exact:true}).getByRole('button',{name:new RegExp(sourceTitle)})).toBeVisible();await page.getByRole('group',{name:'시장 근거 기록 목록',exact:true}).getByRole('button',{name:new RegExp(sourceTitle)}).click();await expect(page.getByLabel('근거 제목',{exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'시장 근거 저장',exact:true})).toBeDisabled();await expect(page.getByText('브랜드 아카이브에서 가져온 근거입니다. 원자료를 수정한 뒤 새 판을 가져오세요. 가져온 근거의 내용은 여기서 변경할 수 없습니다.',{exact:true})).toBeVisible();
  const response=await page.request.get(`/api/growth?campaignId=${campaignId}`),view=await response.json();expect(view.signals).toHaveLength(1);expect(view.signals[0].input.sampleSize).toBeNull();expect(view.signals[0].input.expiresAt).toBe(expiresAt);await post('/api/archive',{action:'review_source',brandId:'ofd',id:sourceId,version:3,status:'confirmed'});await panel.getByRole('button',{name:'자료 목록 새로고침',exact:true}).click();await panel.getByRole('button',{name:'현재 기한을 유지하고 최신 자료 판 사용',exact:true}).click();await expect(expiry).toHaveValue(expiresAt);await expect(panel.getByRole('button',{name:'시장 근거로 가져오기',exact:true})).toBeEnabled();await panel.getByRole('button',{name:'시장 근거로 가져오기',exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'시장 근거를 가져왔습니다.'})).toBeVisible();const revised=await(await page.request.get(`/api/growth?campaignId=${campaignId}`)).json();expect(revised.signals).toHaveLength(2);expect(revised.signals.find((row:{sourceProvenance?:{sourceVersion:number}})=>row.sourceProvenance?.sourceVersion===3)?.sourceReadiness.status).toBe('held');expect(revised.signals.find((row:{sourceProvenance?:{sourceVersion:number}})=>row.sourceProvenance?.sourceVersion===4)?.sourceReadiness.status).toBe('current');expect(attempts).toHaveLength(3);expect(attempts[2]).not.toBe(attempts[1]);const restored=await open();await restored.getByRole('combobox',{name:'브랜드 아카이브 자료 선택',exact:true}).selectOption(sourceId);await expect(restored).toContainText('이미 가져온 자료입니다.');await expect(restored.getByRole('button',{name:'시장 근거로 가져오기',exact:true})).toBeDisabled();expect(await restored.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await restored.getByRole('heading',{name:'확정 시장자료 가져오기',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:`e2e/artifacts/growth-signal-source-${info.project.name}.png`});
 }finally{await context.close().catch(()=>{})}
});

// QA D8 회귀(docs/observations/2026-11-09-qa-global-eval.md): 모든 기능 스위치를 켜고 지점·상품이 있는 캠페인의 성장·판매 탭을 열어도
// /api/ 응답에 4xx·5xx가 없어야 한다(시장 근거 단계의 GET /api/growth/signal-sources 포함, 형제 성장 패널의 첫 조회도 함께 본다).
test('성장·판매 탭 열기: 모든 스위치 켬에서도 API 4xx 없음(D8)',async({browser},info)=>{
 const owner=`signal-d8-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 const bad:string[]=[],seen:string[]=[];
 try{
  const post=async(path:string,data:unknown)=>{const response=await page.request.post(path,{data});expect(response.status(),await response.text()).toBe(200);return response.json()};
  await page.request.get('/api/workspace');
  const flags=(await (await page.request.get('/api/feature-flags')).json()).flags as {flag:string}[];
  for(const f of flags)await post('/api/feature-flags',{action:'set',flag:f.flag,enabled:true});
  const store=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'성수 플래그십',address:'서울 성동구 연무장길 00',tradeArea:'residential',goal:'주말 방문 20% 증가'}}) as {id:string};
  const title=`D8 회귀 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId:store.id,title,goal:'10월 매운 세트 300개 판매'}}) as {id:string};
  await post('/api/growth',{action:'save_catalog',id:'cat-spicy',campaignId,campaignVersion:1,expectedVersion:0,input:{sku:'MD-SPICY-SET',title:'매운 세트(2인)',price:19800,unitCost:7200,variableCost:1800,stock:120,stockUnit:'piece',currency:'KRW',taxBasis:'included',fulfillment:'택배 배송(주문 후 2일)',refunds:'미개봉 7일 내 반품',rightsConfirmed:true,factIds:[],validUntil:'2026-12-31'}});
  // QA N3(2026-11-15): Date.now() 13자리가 든 시장 자료 id(trust-ui 시드 모양)가 있어도 목록은 200이다.
  const stampId=`d8-src-${Date.now()}`,stampTitle='타임스탬프 id 시장 자료',observedAt=new Date(Date.now()-86400000).toISOString();
  runSql(record(owner,'brand_source',stampId,'ofd',{id:stampId,brandId:'ofd',title:stampTitle,category:'market',origin:'manual',status:'confirmed',url:'https://example.com/market',content:'합성 공개 관측',scope:'공개 웹 자료',observedAt,createdAt:observedAt,version:1}));
  const direct=await page.request.get(`/api/growth/signal-sources?campaignId=${encodeURIComponent(campaignId)}`);
  expect(direct.status(),await direct.text()).toBe(200);
  expect(((await direct.json()) as {candidates:{sourceId:string;status:string}[]}).candidates.find(x=>x.sourceId===stampId)?.status).toBe('ready');
  page.on('response',r=>{const path=new URL(r.url()).pathname;if(!path.startsWith('/api/'))return;seen.push(path);if(r.status()>=400)bad.push(`${r.status()} ${r.request().method()} ${path}`)});
  await page.goto(`/?view=campaigns&campaign=${campaignId}`);
  await page.getByRole('tab',{name:'성장·판매',exact:true}).click();
  const region=page.getByRole('region',{name:'확정 시장자료 가져오기',exact:true});
  await expect(region).toBeVisible({timeout:10_000});
  await expect.poll(()=>seen.includes('/api/growth/signal-sources'),{timeout:10_000}).toBe(true);
  await expect(region.getByRole('combobox',{name:'브랜드 아카이브 자료 선택',exact:true})).toContainText(stampTitle);
  await expect(region.getByRole('alert')).toHaveCount(0);
  await page.waitForLoadState('networkidle').catch(()=>{});
  expect(bad).toEqual([]);
 }finally{await context.close().catch(()=>{})}
});
