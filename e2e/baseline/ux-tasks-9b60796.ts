import {test,expect,type Browser,type Locator,type Page,type TestInfo} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {appendFileSync,mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// 과업 하네스 기준선(UX-PLAN-3 10.5): e2e/ux-tasks.spec.ts와 같은 8과제를 UX 3차 시작 시점 Sites83(9b60796) 화면에서 잰 스크립트다.
// 이 저장소의 E2E에는 들지 않는다(파일 이름이 .spec이 아님). 재현: 9b60796 작업 사본의 e2e/에 ux-tasks-baseline.spec.ts로 복사해 그 빌드에서 실행한다.
// 결과(데스크톱 35회·모바일 37회 클릭, 8과제 모두 성공)는 tests/ux-tasks.json baseline에 적었다. 클릭 경로만 옛 화면에 맞췄고 성공 조건은 같다.
// Real local D1/API/Chromium. 인증 헤더 mocked. 외부 호출·광고비 지출 없음.
const names:Record<number,string>={1:'오늘 안건 처리',2:'상품·오퍼·미션 만들기',3:'고객 문의 기한 처리',4:'확대 제안 승인',5:'Meta 준비 점검',6:'발행 승인',7:'주간 성과 확인',8:'전역 중단과 재개'};
function fixture(owner:string,kind:string,id:string,parent:string,data:unknown){
 const quote=(value:string)=>`'${value.replaceAll("'","''")}'`,folder=mkdtempSync(join(tmpdir(),'collective-tasks-'));
 try{const path=join(folder,'fixture.sql');writeFileSync(path,`INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(${[`${owner}:${kind}:${id}`,owner,kind,parent,JSON.stringify(data),new Date().toISOString()].map(quote).join(',')}) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;`);execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config','dist/server/wrangler.json','--local','--persist-to','e2e/.state','--file',path],{stdio:'pipe'});}finally{rmSync(folder,{recursive:true,force:true})}
}
// 측정기: click·check·press는 클릭 1회, fill·selectOption은 입력 칸 1개. 시간은 첫 측정 동작부터 done()까지.
function meter(page:Page){
 let clicks=0,fields=0,start=0;const path:string[]=[],begin=()=>{if(!start)start=Date.now()};
 return {
  click:async(l:Locator,name:string)=>{begin();await l.click();clicks++;path.push(name)},
  check:async(l:Locator,name:string)=>{begin();await l.check();clicks++;path.push(name)},
  press:async(key:string)=>{begin();await page.keyboard.press(key);clicks++;path.push(`[${key}]`)},
  fill:async(l:Locator,value:string)=>{begin();await l.fill(value);fields++},
  select:async(l:Locator,value:string|{label:string})=>{begin();await l.selectOption(value);fields++},
  done:()=>({clicks,fields,ms:Date.now()-start,path}),
 };
}
type Meter=ReturnType<typeof meter>;
async function setup(browser:Browser,info:TestInfo,n:number){
 const owner=`tasks-${n}-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};
 const get=async(path:string)=>{const r=await page.request.get(path);expect(r.status(),await r.text()).toBe(200);return r.json()};
 await page.request.get('/api/workspace');
 return {owner,context,page,post,get,mobile:(page.viewportSize()?.width??1280)<768,m:meter(page)};
}
// 기록·예산 확인. 클릭 수는 예산 이하(래칫).
function report(info:TestInfo,n:number,m:Meter){
 const {clicks,fields,ms,path}=m.done(),line=JSON.stringify({task:n,name:names[n],build:'9b60796',success:true,clicks,fields,ms,project:info.project.name,path});
 info.annotations.push({type:'ux-task',description:line});mkdirSync('e2e/artifacts',{recursive:true});appendFileSync('e2e/artifacts/ux-tasks-baseline.jsonl',line+'\n');
}
const store=(post:(p:string,d:unknown)=>Promise<{id:string}>,name:string)=>post('/api/stores',{action:'save_store',brandId:'ofd',data:{name,address:'합성 주소',tradeArea:'residential',goal:'과업'}});
// 홈의 최근 캠페인 표에서 캠페인을 연다(사이드바·목록을 거치지 않는 최단 경로).
const openCampaign=(page:Page,m:Meter,title:string)=>m.click(page.getByRole('button',{name:title+' 열기',exact:true}),title+' 열기');
const agendaRow=(page:Page,title:string)=>page.getByRole('region',{name:'오늘의 안건',exact:true}).getByRole('button',{name:new RegExp(title)}).first();
// 성장 탭 접기 패널. 안건 행이 이미 그 패널을 열어 두었으면 사용자는 누르지 않는다(그때는 세지 않는다).
async function openPanel(page:Page,m:Meter,text:string,label=text){
 const summary=page.locator('summary').filter({hasText:new RegExp(`^${text}$`)});await expect(summary).toBeVisible();
 if(!await summary.evaluate(e=>(e.parentElement as HTMLDetailsElement).open))await m.click(summary,label);
}

test('과업 1: 오늘 안건 처리',async({browser},info)=>{
 const {context,page,post,get,m}=await setup(browser,info,1);
 try{
  const {id:storeId}=await store(post,'과업1 합성 지점');
  const title=`과업1 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'안건'}});
  const day=(n:number)=>new Date(Date.now()-n*86400000).toISOString().slice(0,10);
  const order=(n:number,no:string)=>post('/api/store-operations',{action:'save_order',storeId,data:{source:'direct',orderNumber:no,orderDate:day(n),mode:'delivery',status:'paid',paidAmount:10000,refundAmount:0,channel:'unknown',campaignId,attributionEvidence:'운영자 확인'}});
  for(let i=0;i<14;i++)await order(i%7,'R'+i);for(let i=0;i<21;i++)await order(7+i,'B'+i);
  await post('/api/growth/detections',{action:'detect',campaignId,campaignVersion:1});
  // 기준선(9b60796): 안건에 '내가 맡기'가 없고 신호 행 제목이 모두 '새 감지 신호'다. 행을 누르면 캠페인 상세 시트의 성장·판매 탭이 열리고,
  // 접힌 '자사 장부 감지 신호'를 펼쳐 해당 신호 '검토' → 담당·다음 행동·검토 기한 입력 → '담당 지정'으로 맡는다.
  await page.goto('/');const agenda=page.getByRole('region',{name:'오늘의 안건',exact:true});
  await m.click(agenda.getByRole('button',{name:new RegExp(`새 감지 신호 ${title}`)}).first(),'안건: 새 감지 신호');
  await openPanel(page,m,'자사 장부 감지 신호.*','자사 장부 감지 신호');
  const panel=page.getByRole('region',{name:'자사 장부 감지 신호',exact:true});
  await m.click(panel.getByRole('button',{name:'최근 7일 유료 주문 증가 검토',exact:true}),'최근 7일 유료 주문 증가 검토');
  const form=panel.getByRole('group',{name:'최근 7일 유료 주문 증가 검토'});
  await m.fill(form.getByRole('textbox',{name:'담당',exact:true}),'운영 담당');await m.fill(form.getByRole('textbox',{name:'다음 행동',exact:true}),'증가 원인 확인');
  const due=form.getByLabel('검토 기한',{exact:true});if(!await due.inputValue())await m.fill(due,new Date(Date.now()+3*86400000).toISOString().slice(0,10));
  await m.click(form.getByRole('button',{name:'담당 지정',exact:true}),'담당 지정');
  await expect(panel.getByRole('status').filter({hasText:'담당과 기한을 지정했습니다.'})).toBeVisible();
  const {signals}=await get(`/api/growth/detections?campaignId=${campaignId}`) as {signals:{status:string;detection:{title:string}}[]};
  expect(signals.find(s=>s.detection.title==='최근 7일 유료 주문 증가')?.status).toBe('acknowledged');
  report(info,1,m);
 }finally{await context.close()}
});

test('과업 2: 상품·오퍼·미션 만들기',async({browser},info)=>{
 const {context,page,post,get,m}=await setup(browser,info,2);
 try{
  const before=new Date(Date.now()-86400000).toISOString(),day=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  const {id:storeId}=await store(post,'과업2 합성 지점');
  const title=`과업2 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'판매'}});
  await post('/api/brand-facts',{action:'save_fact',confirmed:true,data:{brandId:'ofd',key:'과업 상품',value:'근거',status:'confirmed',source:'합성 운영 확인',verifiedAt:before,validUntil:new Date(Date.now()+30*86400000).toISOString()}});
  const save=(action:string,id:string,input:unknown)=>post('/api/growth',{action,id,input,campaignId,campaignVersion:1,expectedVersion:0});
  await save('save_signal','t2-signal',{title:'근거',sourceUrl:'https://example.com/m',observedAt:before,expiresAt:day,sourceType:'market',summary:'관측',sampleSize:null});
  await save('save_need','t2-need',{title:'니즈',situation:'상황',desiredOutcome:'결과',alternative:'대안',barrier:'장애',counterEvidence:'반례',signalIds:['t2-signal'],deadline:day,nextAction:'검증',assignee:'담당'});
  await page.goto('/');
  await openCampaign(page,m,title);await m.click(page.getByRole('tab',{name:'성장·판매',exact:true}),'성장·판매');
  // 기준선: '판매 기본 기록' 영역 이름이 없고 성장2 워크스페이스 안에 단계 버튼이 있다. '다음 단계' 버튼이 없어 단계 버튼을 직접 누른다.
  const panel=page.getByRole('region',{name:'성장2 판매 워크스페이스',exact:true}),saved=panel.getByRole('status').filter({hasText:'서버에 저장했습니다.'}),step=(name:string)=>m.click(panel.getByRole('navigation',{name:'성장 작업 단계'}).getByRole('button',{name,exact:true}),name);
  // 상품
  await step('상품');
  await m.fill(panel.getByLabel('SKU',{exact:true}),'T2-SKU');await m.fill(panel.getByLabel('상품명',{exact:true}),'과업 상품');await m.fill(panel.getByLabel('판매 단가 (원)',{exact:true}),'12000');
  await m.check(panel.getByRole('checkbox',{name:/^과업 상품: 근거/}),'확정 사실 연결');
  await m.click(panel.getByRole('button',{name:'상품 저장',exact:true}),'상품 저장');await expect(saved).toBeVisible();
  // 오퍼
  await step('판매 오퍼');
  await m.fill(panel.getByLabel('오퍼명',{exact:true}),'과업 오퍼');await m.select(panel.getByRole('combobox',{name:'연결 상품',exact:true}),{label:'과업 상품 · v1'});await m.select(panel.getByRole('combobox',{name:'연결 니즈 가설',exact:true}),{label:'니즈 · v1'});await m.fill(panel.getByLabel('오퍼 단가 (원)',{exact:true}),'12000');
  await m.click(panel.getByRole('button',{name:'판매 오퍼 저장',exact:true}),'판매 오퍼 저장');await expect(saved).toBeVisible();
  // 미션
  await step('판매 미션');
  await m.fill(panel.getByLabel('미션 제목',{exact:true}),'과업 미션');await m.select(panel.getByRole('combobox',{name:'연결 판매 오퍼',exact:true}),{label:'과업 오퍼 · v1'});
  await m.click(panel.getByRole('button',{name:'판매 미션 저장',exact:true}),'판매 미션 저장');await expect(saved).toBeVisible();
  const v=await get(`/api/growth?campaignId=${campaignId}`) as {catalogs:{id:string;input:{sku:string}}[];offers:{id:string;input:{catalogId:string;title:string}}[];missions:{input:{offerId:string;title:string}}[]};
  const catalog=v.catalogs.find(c=>c.input.sku==='T2-SKU'),offer=v.offers.find(o=>o.input.title==='과업 오퍼');
  expect(catalog).toBeTruthy();expect(offer?.input.catalogId).toBe(catalog!.id);expect(v.missions.find(x=>x.input.title==='과업 미션')?.input.offerId).toBe(offer!.id);
  report(info,2,m);
 }finally{await context.close()}
});

test('과업 3: 고객 문의 기한 처리',async({browser},info)=>{
 const {context,page,post,get,m}=await setup(browser,info,3);
 try{
  const {id:storeId}=await store(post,'과업3 합성 지점');
  const title=`과업3 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'문의'}});
  const now=Date.now(),id='cs-task3';
  await post('/api/growth/cs',{action:'save_ticket',id,expectedVersion:0,campaignId,campaignVersion:1,requestId:crypto.randomUUID(),input:{category:'shipping_delay',channel:'chat',summary:'배송 지연 문의, 출고 일정 안내 필요',lineId:'',receivedAt:new Date(now-5*3600000).toISOString(),promisedBy:new Date(now-3600000).toISOString(),assignee:'CS 담당',priority:'normal'}});
  await page.goto('/');
  await m.click(agendaRow(page,'고객 문의 약속 기한 초과'),'안건: 고객 문의 약속 기한 초과');
  await openPanel(page,m,'고객 문의·약속 기한');
  const panel=page.getByRole('region',{name:'고객 문의 처리',exact:true});
  await m.click(panel.getByRole('button',{name:`${id} 처리 기록`,exact:true}),`${id} 처리 기록`);
  await m.select(panel.getByRole('combobox',{name:'처리 종류',exact:true}),'resolve');await m.select(panel.getByRole('combobox',{name:'해결 방법',exact:true}),'shipped');await m.fill(panel.getByRole('textbox',{name:'처리 증빙 ID',exact:true}),'ship-1');
  await m.click(panel.getByRole('button',{name:'처리 저장',exact:true}),'처리 저장');
  await expect(panel.getByRole('status').filter({hasText:'처리를 기록했습니다'})).toBeVisible();await expect(panel).toContainText('미해결 0건 · 기한 초과 0건');
  const {tickets}=await get(`/api/growth/cs?campaignId=${campaignId}`) as {tickets:{id:string;status:string}[]};
  expect(tickets.find(t=>t.id===id)?.status).toBe('resolved');
  report(info,3,m);
 }finally{await context.close()}
});

test('과업 4: 확대 제안 승인',async({browser},info)=>{
 const {owner,context,page,post,get,m}=await setup(browser,info,4);
 try{
  const before=new Date(Date.now()-86400000).toISOString(),after=new Date(Date.now()+30*86400000).toISOString(),day=after.slice(0,10);
  const {id:storeId}=await store(post,'과업4 합성 지점');
  const title=`과업4 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'확대'}});
  const {id:factId}=await post('/api/brand-facts',{action:'save_fact',confirmed:true,data:{brandId:'ofd',key:'합성 상품',value:'근거',status:'confirmed',source:'합성 운영 확인',verifiedAt:before,validUntil:after}});
  const save=(action:string,id:string,input:unknown)=>post('/api/growth',{action,id,input,campaignId,campaignVersion:1,expectedVersion:0});
  await save('save_signal','x-signal',{title:'근거',sourceUrl:'https://example.com/m',observedAt:before,expiresAt:day,sourceType:'market',summary:'관측',sampleSize:null});
  await save('save_need','x-need',{title:'니즈',situation:'상황',desiredOutcome:'결과',alternative:'대안',barrier:'장애',counterEvidence:'반례',signalIds:['x-signal'],deadline:day,nextAction:'검증',assignee:'담당'});
  await save('save_catalog','x-catalog',{sku:'X-SKU',title:'상품',price:100,unitCost:20,variableCost:10,stock:0,stockUnit:'piece',currency:'KRW',taxBasis:'included',fulfillment:'배송',refunds:'반품',rightsConfirmed:true,factIds:[factId],validUntil:day});
  await save('save_offer','x-offer',{title:'오퍼',catalogId:'x-catalog',catalogVersion:1,needId:'x-need',price:100,quantity:1,landingUrl:'https://example.com/buy',purchaseReason:'이유',priceApproved:true});
  await save('save_mission','x-mission',{title:'미션',offerId:'x-offer',offerVersion:1,assignee:'담당',deadline:day,nextAction:'판매',channel:'storefront',budget:1000,lossLimit:1000,stopRule:'한도',fulfillmentOwner:'배송'});
  await post('/api/growth/operations',{action:'create_inventory',campaignId,campaignVersion:1,input:{sku:'X-SKU',locationId:storeId,unit:'piece',onHand:50},observedAt:before,evidenceRef:'stock'});
  await post('/api/growth/authority',{action:'save_authority',id:'x-auth',campaignId,campaignVersion:1,expectedVersion:0,sign:true,input:{accountId:'acct',channel:'storefront',status:'active',maxTier:'T3',allowedActions:['publish','spend'],startsAt:before,expiresAt:after,periodStart:before,periodEnd:after,totalCap:10000,dayCap:10000,weekCap:10000,lossCap:10000}});
  const digest='a'.repeat(64),now=new Date().toISOString();
  fixture(owner,'growth_experiment','x-exp',campaignId,{id:'x-exp',brandId:'ofd',campaignId,storeId,version:2,status:'registered',input:{title:'실험',mode:'confirm',aa:false,missionId:'x-mission',missionVersion:1,offerId:'x-offer',offerVersion:1,channel:'storefront',interventionRefs:[{kind:'offer',id:'x-offer',version:1}],minEffect:0.05,metric:'paid_orders',hypothesis:'가설',intervention:'개입',assignmentUnit:'pseudonymous_visitor',treatmentShare:0.5,lowerBound:0,upperBound:1,minSamplePerArm:10,startAt:before,endAt:before,maturityDays:0,stopRule:'중단'},seed:'s',registration:{digest,at:before,by:owner,refs:[]}});
  fixture(owner,'growth_experiment_result','x-exp:1',campaignId,{id:'x-exp:1',designId:'x-exp',campaignId,brandId:'ofd',analysisNumber:1,designDigest:digest,inputDigest:'i1',analysis:{status:'supported',analysisVersion:'growth_sales_v1',reasons:['조건부 개선 근거'],assigned:{control:20,treatment:20},analysed:{control:20,treatment:20},excluded:{notExposed:0,trackingIncomplete:0,contaminated:0,unknownValue:0},srm:{chi2:0,p:1,mismatch:false},statistics:{status:'supported',method:'hoeffding_union_alpha_spending_v1',alpha:0.025,controlSample:20,treatmentSample:20,controlMean:0.1,treatmentMean:0.4,difference:0.3,interval:[0.1,0.5],reason:'조건부 개선 근거'},descriptive:{controlMean:0.1,treatmentMean:0.4},causalScope:'storefront 등록 범위'},lineage:[],recordedAt:now,recordedBy:owner});
  // 제안은 관리자가 API로 올린 상태로 둔다. 과업은 소유자의 승인·예약이다.
  const id='expansion-task4';
  await post('/api/growth/expansion',{action:'propose',id,expectedVersion:0,campaignId,campaignVersion:1,requestId:crypto.randomUUID(),input:{missionId:'x-mission',missionVersion:1,experimentId:'x-exp',analysisNumber:1,nextBudget:1200,addQuantity:10,rationale:'확증 개선'}});
  await page.goto('/');
  await m.click(agendaRow(page,'확대 제안 승인 대기'),'안건: 확대 제안 승인 대기');
  await openPanel(page,m,'검증된 확대·예산 예약');
  const panel=page.getByRole('region',{name:'검증된 확대',exact:true});
  await m.select(panel.getByRole('combobox',{name:'예약에 쓸 활성 위임',exact:true}),'x-auth');
  await m.click(panel.getByRole('button',{name:`${id} 소유자 승인·예약`,exact:true}),`${id} 소유자 승인·예약`);
  await expect(panel.getByRole('status').filter({hasText:'확대 예산을 예약했습니다'})).toBeVisible();await expect(panel).toContainText('확대 예약 200원 · 원장 reserved');
  const {proposals}=await get(`/api/growth/expansion?campaignId=${campaignId}`) as {proposals:{id:string;status:string;commitment?:{status:string}}[]};
  const p=proposals.find(x=>x.id===id);expect(p?.status).toBe('reserved');expect(p?.commitment?.status).toBe('reserved');
  report(info,4,m);
 }finally{await context.close()}
});

test('과업 5: Meta 준비 점검',async({browser},info)=>{
 const {context,page,post,get,m}=await setup(browser,info,5);
 try{
  const title=`과업5 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title,goal:'구매 전환 준비',budget:0}});
  await page.goto('/');
  await openCampaign(page,m,title);await m.click(page.getByRole('tab',{name:'Meta 광고 준비',exact:true}),'Meta 광고 준비');
  const panel=page.getByRole('region',{name:'Meta 광고 준비'});
  await m.click(panel.getByRole('button',{name:'2. 상품과 수익',exact:true}),'2. 상품과 수익');
  await m.fill(panel.getByLabel('상품·오퍼',{exact:true}),'합성 상품 1개');await m.fill(panel.getByLabel('판매가 (원)',{exact:true}),'12000');await m.fill(panel.getByLabel('상품 원가 (원)',{exact:true}),'4000');await m.fill(panel.getByLabel('건당 변동비 (원)',{exact:true}),'2000');
  await m.click(panel.getByRole('button',{name:'3. 예산과 일정',exact:true}),'3. 예산과 일정');
  await m.fill(panel.getByLabel('총 광고 예산 (원)',{exact:true}),'60000');
  await m.click(panel.getByRole('button',{name:'4. 준비 점검',exact:true}),'4. 준비 점검');
  await m.check(panel.getByRole('checkbox',{name:'재고·제공 가능 수량 확인',exact:true}),'재고·제공 가능 수량 확인');
  await m.click(panel.getByRole('button',{name:'준비 계획 저장',exact:true}),'준비 계획 저장');
  await expect(panel.getByRole('status')).toContainText('준비 계획을 저장했습니다');
  const v=await get(`/api/meta-ads?campaignId=${campaignId}`) as {plan:{input:{price:number;totalBudget:number;checks:{inventory:boolean}}}|null};
  expect(v.plan?.input.checks.inventory).toBe(true);expect(v.plan?.input.price).toBe(12000);expect(v.plan?.input.totalBudget).toBe(60000);
  report(info,5,m);
 }finally{await context.close()}
});

test('과업 6: 발행 승인',async({browser},info)=>{
 const {context,page,post,get,m}=await setup(browser,info,6);
 try{
  const before=new Date(Date.now()-86400000).toISOString(),after=new Date(Date.now()+30*86400000).toISOString(),day=after.slice(0,10);
  const {id:storeId}=await store(post,'과업6 합성 지점');
  const title=`과업6 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'상세 개선'}});
  const {id:factId}=await post('/api/brand-facts',{action:'save_fact',confirmed:true,data:{brandId:'ofd',key:'배송 조건',value:'평일 당일 출고',status:'confirmed',source:'합성 운영 확인',verifiedAt:before,validUntil:after}});
  const save=(action:string,id:string,input:unknown)=>post('/api/growth',{action,id,input,campaignId,campaignVersion:1,expectedVersion:0});
  await save('save_catalog','landing-catalog',{sku:'LANDING-SKU',title:'상세 상품',price:12000,unitCost:4000,variableCost:1000,stock:0,stockUnit:'piece',currency:'KRW',taxBasis:'included',fulfillment:'배송 조건',refunds:'반품 조건',rightsConfirmed:true,factIds:[factId],validUntil:day});
  await save('save_offer','landing-offer',{title:'상세 오퍼',catalogId:'landing-catalog',catalogVersion:1,needId:'',price:12000,quantity:1,landingUrl:'https://example.com/buy',purchaseReason:'준비 단축',priceApproved:true});
  const id='landing-task6';
  await post('/api/growth/landing',{action:'save_proposal',id,expectedVersion:0,campaignId,campaignVersion:1,requestId:crypto.randomUUID(),input:{title:'배송 불안 해소',offerId:'landing-offer',offerVersion:1,journeyId:'',journeyVersion:0,landingUrl:'https://example.com/buy',rationale:'배송 문의가 많음',rollbackPlan:'이전 문구 복구',sections:[{kind:'shipping',before:'',after:'평일 오후 2시 전 주문은 당일 출고',factIds:[factId]}]}});
  await page.goto('/');
  await m.click(agendaRow(page,'상세페이지 수정안 승인 대기'),'안건: 상세페이지 수정안 승인 대기');
  await openPanel(page,m,'상세페이지 수정안·적용 확인');
  const panel=page.getByRole('region',{name:'상세페이지 수정안',exact:true});
  await m.click(panel.getByRole('button',{name:`${id} 승인`,exact:true}),`${id} 승인`);
  await expect(panel.getByRole('status').filter({hasText:'페이지는 아직 바뀌지 않았습니다'})).toBeVisible();
  const {proposals}=await get(`/api/growth/landing?campaignId=${campaignId}`) as {proposals:{id:string;status:string}[]};
  expect(proposals.find(p=>p.id===id)?.status).toBe('approved');
  report(info,6,m);
 }finally{await context.close()}
});

test('과업 7: 주간 성과 확인',async({browser},info)=>{
 const {context,page,post,m}=await setup(browser,info,7);
 try{
  const title=`과업7 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title,goal:'주간 성과'}});
  const day=(n:number)=>new Date(Date.now()-n*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
  // 직전 주와 최근 7일(오늘 포함) 성과 기록 두 건.
  for(const [from,to,revenue] of [[13,7,412000],[6,0,538000]] as const)await post('/api/action',{action:'save_metric',campaignId,schemaVersion:2,periodStart:day(from),periodEnd:day(to),scope:'전체 주문',source:'POS 정산서',definition:'KST 순매출',method:'export',revenue,orders:20,variableCosts:100000,adSpend:30000,productionCost:0});
  await page.goto('/');
  await openCampaign(page,m,title);await m.click(page.getByRole('tab',{name:'성과',exact:true}),'성과');
  // 기준선: '기간별 성과 비교' 표가 없고 기록마다 '기간 · 범위' 제목 카드가 있다. 같은 두 번의 클릭 뒤 최근 7일 카드의 순매출을 확인한다.
  const heading=page.getByRole('tabpanel',{name:'성과',exact:true}).getByRole('heading',{name:`${day(6)} ~ ${day(0)} · 전체 주문`,exact:true});
  await expect(heading).toBeVisible();await expect(heading.locator('xpath=following::strong[1]')).toHaveText('538,000원');
  report(info,7,m);
 }finally{await context.close()}
});

test('과업 8: 전역 중단과 재개',async({browser},info)=>{
 const {context,page,post,get,mobile,m}=await setup(browser,info,8);
 try{
  await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title:`과업8 ${info.project.name}`,goal:'전역 중단'}});
  await page.goto('/');
  if(mobile)await m.click(page.locator('[data-sidebar="trigger"]').first(),'사이드바 열기');
  await m.click(page.getByRole('button',{name:'연결 및 설정',exact:true}),'연결 및 설정');
  // 모바일 사이드바는 메뉴를 눌러도 열린 채로 남으면 사용자가 닫아야 한다(그때만 센다).
  if(mobile&&await page.locator('[data-sidebar="sidebar"][data-mobile="true"]').isVisible())await m.press('Escape');
  const panel=page.getByRole('region',{name:'전역 실행 중단',exact:true}),reason=panel.getByRole('textbox',{name:'중단·재개 사유',exact:true});
  await m.fill(reason,'외부 집행 경로 점검');await m.click(panel.getByRole('button',{name:'모든 신규 실행 중단',exact:true}),'모든 신규 실행 중단');
  await expect(panel.getByRole('status')).toContainText('중단 요청을 기록했습니다.');
  expect((await get('/api/growth/stop')).state.status).toBe('stopped');
  await m.fill(reason,'점검 완료');await m.click(panel.getByRole('button',{name:'소유자로서 실행 재개',exact:true}),'소유자로서 실행 재개');
  await expect(panel.getByRole('status')).toContainText('재개 요청을 기록했습니다.');
  const v=await get('/api/growth/stop');expect(v.state.status).toBe('running');expect(v.state.version).toBe(2);
  report(info,8,m);
 }finally{await context.close()}
});
