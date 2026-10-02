import {test,expect,type Locator,type Page,type TestInfo} from '@playwright/test';
import {appendFileSync,mkdirSync} from 'node:fs';
import {taskContext,type TaskContext} from './helpers/ux-task-seeds';
// UX-PLAN-3 1차원 정보구조 '3클릭' 하네스: 기록 유형마다 홈(/)에서 그 기록이 보이는 화면·패널까지 사람처럼 눌러 닿는 횟수를 잰다(데스크톱·모바일).
// 길은 두 가지다. menu: 메뉴·홈 카드·탭만 누른다(입력 없음). search: 바로 가기를 연다(데스크톱 '/' 1회, 모바일 머리 띠 '검색' 1회) → 이름을 친다 → 결과를 누른다.
// 누름·키는 1회로 세고, 검색어 타이핑은 클릭에 넣지 않고 typed(글자 수)로 따로 남긴다. 기다림·확인은 세지 않는다.
// 측정 구간에서는 page.goto를 쓰지 않는다(시작 page.goto('/')만). 준비 데이터는 API로 넣고 측정에 넣지 않는다(e2e/helpers/ux-task-seeds.ts와 같은 방식).
// 결과는 annotation(ux-reach)과 e2e/artifacts/ux-reach.jsonl에 남기고, 모든 길이 3회 이하인지 단언한다.
// 1280×800 사이드바: 바닥 묶음(연결 및 설정·로그인 계정)이 스크롤 없이 화면 안에 있고 주 메뉴가 잘리지 않는지, 모바일 시트에서도 바닥 묶음이 보이는지 본다(평가 10회차 결함 3).
// Real local D1/API/Chromium. 인증 헤더 mocked. 외부 호출·광고비 지출 없음.
const LIMIT=3;
type Post=TaskContext['post'];
function meter(page:Page){
 let clicks=0,typed=0;const path:string[]=[];
 return {
  click:async(l:Locator,name:string)=>{await l.click();clicks++;path.push(name)},
  press:async(key:string)=>{await page.keyboard.press(key);clicks++;path.push(`[${key}]`)},
  type:async(l:Locator,text:string)=>{await l.fill(text);typed+=text.length;path.push(`(입력 ${text.length}자)`)},
  done:()=>({clicks,typed,path}),
 };
}
type Meter=ReturnType<typeof meter>;
function report(info:TestInfo,kind:string,route:'menu'|'search',m:Meter){
 const {clicks,typed,path}=m.done(),line=JSON.stringify({kind,route,clicks,typed,project:info.project.name,path});
 info.annotations.push({type:'ux-reach',description:line});mkdirSync('e2e/artifacts',{recursive:true});appendFileSync('e2e/artifacts/ux-reach.jsonl',line+'\n');
 expect(clicks,`${kind}(${route}) ${LIMIT}클릭 초과: ${path.join(' → ')}`).toBeLessThanOrEqual(LIMIT);
}
const isMobile=(page:Page)=>(page.viewportSize()?.width??1280)<768;
// 홈에서 측정을 시작한다. 제목은 서버가 그리므로 화면이 동작하기(단축키 연결) 전일 수 있다. 첫 그림 다음에 그리는 통계 줄(AfterPaint)이 보인 뒤부터 센다.
async function home(page:Page){await page.goto('/');await expect(page.getByRole('heading',{level:1,name:'워크스페이스'})).toBeVisible();await expect(page.locator('.stats-row')).toBeVisible()}
// 사이드바 메뉴: 모바일은 시트를 먼저 연다. 메뉴를 고르면 시트가 스스로 닫히고, 남아 있으면 사람이 닫는다(그때만 센다, e2e/ux-tasks.spec.ts 과업 8과 같은 규칙).
async function menu(page:Page,m:Meter,name:string){
 if(isMobile(page))await m.click(page.locator('[data-sidebar="trigger"]').first(),'사이드바 열기');
 await m.click(page.locator('[data-sidebar="sidebar"]').getByRole('button',{name,exact:true}),name);
 if(isMobile(page)){const sheet=page.locator('[data-sidebar="sidebar"][data-mobile="true"]');await sheet.waitFor({state:'hidden',timeout:1500}).catch(()=>{});if(await sheet.isVisible())await m.press('Escape')}
}
// 바로 가기 열기: 데스크톱은 '/' 단축키, 모바일은 머리 띠의 '검색' 버튼.
async function search(page:Page,m:Meter,query:string){
 if(isMobile(page))await m.click(page.locator('.topbar').getByRole('button',{name:'검색',exact:true}),'검색');else await m.press('/');
 const palette=page.getByRole('dialog',{name:'바로 가기'});await expect(palette).toBeVisible();
 await m.type(palette.getByPlaceholder('화면·캠페인·기록 검색'),query);return palette;
}
async function pick(m:Meter,palette:Locator,name:string|RegExp,label:string){const option=palette.getByRole('option',{name}).first();await expect(option).toBeVisible();await m.click(option,label)}
const openCampaign=(page:Page,m:Meter,title:string)=>m.click(page.getByRole('button',{name:title+' 열기',exact:true}),title+' 열기');
const tab=(page:Page,m:Meter,name:string)=>m.click(page.getByRole('tab',{name,exact:true}),name+' 탭');
// 성장 탭 접기 패널·작업 단계: 이미 열려 있으면 사람이 누르지 않는다(세지 않는다).
async function panel(page:Page,m:Meter,text:string){const summary=page.locator('summary').filter({hasText:new RegExp(`^${text}$`)});await expect(summary).toBeVisible();if(!await summary.evaluate(e=>(e.parentElement as HTMLDetailsElement).open))await m.click(summary,text)}
async function step(page:Page,m:Meter,name:string){const b=page.getByRole('navigation',{name:'성장 작업 단계'}).getByRole('button',{name,exact:true});await expect(b).toBeVisible();if(await b.getAttribute('aria-pressed')!=='true')await m.click(b,name+' 단계')}

// 준비 데이터(측정 밖, API).
const day=(n:number)=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
const store=(post:Post,name:string)=>post('/api/stores',{action:'save_store',brandId:'ofd',data:{name,address:'합성 주소',tradeArea:'residential',goal:'도달'}}) as Promise<{id:string}>;
const campaign=(post:Post,data:Record<string,unknown>)=>post('/api/action',{action:'save_campaign',data:{brandId:'ofd',goal:'도달 측정',...data}}) as Promise<{id:string}>;
const growth=(post:Post,campaignId:string)=>(action:string,id:string,input:unknown)=>post('/api/growth',{action,id,input,campaignId,campaignVersion:1,expectedVersion:0});
async function salesChain(post:Post,campaignId:string,p:string){
 const save=growth(post,campaignId),before=new Date(Date.now()-86400000).toISOString();
 await save('save_signal','reach-signal',{title:`도달 근거 ${p}`,sourceUrl:'https://example.com/m',observedAt:before,expiresAt:day(30),sourceType:'market',summary:'관측',sampleSize:null});
 await save('save_catalog','reach-catalog',{sku:'REACH-SKU',title:'도달 상품',price:10000,unitCost:3000,variableCost:1000,stock:0,stockUnit:'piece',currency:'KRW',taxBasis:'included',fulfillment:'배송',refunds:'반품',rightsConfirmed:true,factIds:[],validUntil:day(30)});
 await save('save_offer','reach-offer',{title:`도달 오퍼 ${p}`,catalogId:'reach-catalog',catalogVersion:1,needId:'',price:10000,quantity:1,landingUrl:'https://example.com/buy',purchaseReason:'이유',priceApproved:true});
 await save('save_mission','reach-mission',{title:'도달 미션',offerId:'reach-offer',offerVersion:1,assignee:'담당',deadline:day(30),nextAction:'판매',channel:'storefront',budget:0,lossLimit:0,stopRule:'한도',fulfillmentOwner:'배송'});
}
async function setup(browser:import('@playwright/test').Browser,info:TestInfo,n:number){return taskContext(browser,info,'reach',n)}

test('도달 1: 캠페인',async({browser},info)=>{
 const {context,page,post}=await setup(browser,info,1);
 try{
  const title=`도달 캠페인 ${info.project.name}`;await campaign(post,{title});
  const opened=page.getByRole('heading',{level:1,name:title});
  await home(page);let m=meter(page);await openCampaign(page,m,title);await expect(opened).toBeVisible();report(info,'캠페인','menu',m);
  await home(page);m=meter(page);await pick(m,await search(page,m,title),title,'캠페인 결과');await expect(opened).toBeVisible();report(info,'캠페인','search',m);
 }finally{await context.close()}
});

test('도달 2: 브랜드 사실(아카이브 확인 사실)',async({browser},info)=>{
 const {context,page,post}=await setup(browser,info,2);
 try{
  const key=`도달 사실 ${info.project.name}`,before=new Date(Date.now()-86400000).toISOString();
  await post('/api/brand-facts',{action:'save_fact',confirmed:true,data:{brandId:'ofd',key,value:'평일 당일 출고',status:'confirmed',source:'합성 운영 확인',verifiedAt:before,validUntil:new Date(Date.now()+30*86400000).toISOString()}});
  const seen=()=>expect(page.getByRole('region',{name:'브랜드 확인 사실'}).getByText(key).first()).toBeVisible();
  await home(page);let m=meter(page);await m.click(page.locator('.brand-card').filter({hasText:'Old Ferry Donut'}),'홈 브랜드 카드');await tab(page,m,'확인 사실');await seen();report(info,'브랜드 사실','menu',m);
  await home(page);m=meter(page);await pick(m,await search(page,m,'Old Ferry'),/^Old Ferry Donut/,'브랜드 결과');await tab(page,m,'확인 사실');await seen();report(info,'브랜드 사실','search',m);
 }finally{await context.close()}
});

test('도달 3: 주문(주문 장부)',async({browser},info)=>{
 const {context,page,post}=await setup(browser,info,3);
 try{
  const {id:storeId}=await store(post,'도달 합성 지점'),{id:campaignId}=await campaign(post,{storeId,title:`도달 주문 ${info.project.name}`}),orderNumber=`REACH-${info.project.name}`;
  await post('/api/store-operations',{action:'save_order',storeId,data:{source:'direct',orderNumber,orderDate:new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'}),mode:'delivery',status:'paid',paidAmount:10000,refundAmount:0,channel:'unknown',campaignId,attributionEvidence:'운영자 확인'}});
  await home(page);const m=meter(page);await menu(page,m,'점포 마케팅');await tab(page,m,'주문 장부');
  await expect(page.getByText(orderNumber).first()).toBeVisible();report(info,'주문','menu',m);
 }finally{await context.close()}
});

test('도달 4: 성장 기록(시장 근거·판매 오퍼)',async({browser},info)=>{
 const {context,page,post}=await setup(browser,info,4);
 try{
  const p=info.project.name,title=`도달 성장 ${p}`,{id:campaignId}=await campaign(post,{title});await salesChain(post,campaignId,p);
  const region=page.getByRole('region',{name:'판매 기본 기록',exact:true});
  for(const [kind,label,name] of [['시장 근거','시장 근거',`도달 근거 ${p}`],['판매 오퍼','판매 오퍼',`도달 오퍼 ${p}`]] as const){
   await home(page);let m=meter(page);await openCampaign(page,m,title);await tab(page,m,'성장·판매');await step(page,m,label);
   await expect(region.getByText(name).first()).toBeVisible();report(info,kind,'menu',m);
   await home(page);m=meter(page);await pick(m,await search(page,m,name),new RegExp(`^${label}: ${name}`),`${label} 결과`);
   await expect(region.getByText(name).first()).toBeVisible();report(info,kind,'search',m);
  }
 }finally{await context.close()}
});

test('도달 5: 판매 실험',async({browser},info)=>{
 const {context,page,post}=await setup(browser,info,5);
 try{
  const p=info.project.name,title=`도달 실험 캠페인 ${p}`,name=`도달 실험 ${p}`,{id:campaignId}=await campaign(post,{title});await salesChain(post,campaignId,p);
  const local=(ms:number)=>new Date(ms).toISOString();
  await post('/api/growth/experiments',{action:'save_design',id:'reach-exp',expectedVersion:0,campaignId,campaignVersion:1,requestId:crypto.randomUUID(),input:{title:name,mode:'confirm',aa:false,hypothesis:'배송 문구가 구매를 늘린다',missionId:'reach-mission',missionVersion:1,offerId:'reach-offer',offerVersion:1,channel:'storefront',intervention:'배송 문구 교체',interventionRefs:[{kind:'offer',id:'reach-offer',version:1}],assignmentUnit:'pseudonymous_visitor',treatmentShare:0.5,metric:'paid_orders',lowerBound:0,upperBound:1,minEffect:0.05,minSamplePerArm:10,startAt:local(Date.now()+86400000),endAt:local(Date.now()+15*86400000),maturityDays:7,stopRule:'손실 한도'}});
  const seen=()=>expect(page.getByRole('region',{name:'판매 실험',exact:true}).getByText(name).first()).toBeVisible();
  await home(page);let m=meter(page);await openCampaign(page,m,title);await tab(page,m,'성장·판매');await panel(page,m,'판매 실험·사전등록·분석');await seen();report(info,'판매 실험','menu',m);
  await home(page);m=meter(page);await pick(m,await search(page,m,name),new RegExp(`^판매 실험: ${name}`),'판매 실험 결과');await seen();report(info,'판매 실험','search',m);
 }finally{await context.close()}
});

test('도달 6: 고객 문의',async({browser},info)=>{
 const {context,page,post}=await setup(browser,info,6);
 try{
  const p=info.project.name,title=`도달 문의 캠페인 ${p}`,summary=`도달 문의 배송 일정 ${p}`,{id:campaignId}=await campaign(post,{title}),now=Date.now();
  await post('/api/growth/cs',{action:'save_ticket',id:'reach-cs',expectedVersion:0,campaignId,campaignVersion:1,requestId:crypto.randomUUID(),input:{category:'shipping_delay',channel:'chat',summary,lineId:'',receivedAt:new Date(now-3600000).toISOString(),promisedBy:new Date(now+5*3600000).toISOString(),assignee:'CS 담당',priority:'normal'}});
  const seen=()=>expect(page.getByRole('region',{name:'고객 문의 처리',exact:true}).getByText(summary).first()).toBeVisible();
  await home(page);let m=meter(page);await openCampaign(page,m,title);await tab(page,m,'성장·판매');await panel(page,m,'고객 문의·약속 기한');await seen();report(info,'고객 문의','menu',m);
  await home(page);m=meter(page);await pick(m,await search(page,m,summary),new RegExp(`^고객 문의: ${summary}`),'고객 문의 결과');await seen();report(info,'고객 문의','search',m);
 }finally{await context.close()}
});

test('도달 7: 학습 규칙',async({browser},info)=>{
 const {context,page,post,get}=await setup(browser,info,7);
 try{
  // 운영자 선호 규칙(초안)은 같은 브랜드의 사람 판정 2건을 인용한다(e2e/playbook.spec.ts와 같은 준비).
  const {id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'oda',title:`도달 학습 ${info.project.name}`,goal:'교정 판정',budget:0}});
  for(const role of ['cmo','insight']){const {id}=await post('/api/action',{action:'save_artifact',campaignId,role,title:'도달 '+role,content:'## 목표\n평일 방문을 늘리는 실행 초안입니다.'});await post('/api/action',{action:'review_artifact',id,version:1,decision:'revision',note:'첫 문장을 더 짧게',reasonCodes:['voice']})}
  const {reviewDecisions}=await get('/api/learning') as {reviewDecisions:{id:string;brandId:string}[]},text='첫 문장은 스무 자 안쪽으로 쓴다.';
  await post('/api/learning',{action:'playbook_create',data:{brandId:'oda',text,role:'',channel:'',origin:'review',citations:reviewDecisions.filter(d=>d.brandId==='oda').map(d=>d.id).slice(0,2)}});
  const seen=()=>expect(page.getByRole('region',{name:'운영자 선호 규칙'}).locator('.learning-rule').filter({hasText:text})).toBeVisible();
  await home(page);let m=meter(page);await menu(page,m,'바이럴 학습');await tab(page,m,'학습 규칙');await seen();report(info,'학습 규칙','menu',m);
  await home(page);m=meter(page);await pick(m,await search(page,m,'바이럴 학습'),/^바이럴 학습/,'화면 결과');await tab(page,m,'학습 규칙');await seen();report(info,'학습 규칙','search',m);
 }finally{await context.close()}
});

test('도달 8: 작업물(검토할 작업)',async({browser},info)=>{
 const {context,page,post}=await setup(browser,info,8);
 try{
  const p=info.project.name,{id:campaignId}=await campaign(post,{title:`도달 작업물 캠페인 ${p}`}),name=`도달 작업물 ${p}`;
  await post('/api/action',{action:'save_artifact',campaignId,role:'cmo',title:name,content:'## 목표\n검토할 작업물입니다.'});
  // 작업물 탭이 열리고 그 작업물이 보인다.
  const seen=async()=>{await expect(page.getByRole('tab',{name:/^작업물/})).toHaveAttribute('aria-selected','true');await expect(page.getByRole('tabpanel').getByText(name).first()).toBeVisible()};
  await home(page);let m=meter(page);await m.click(page.locator('.stat').filter({hasText:'검토할 작업'}),'홈 검토할 작업');await m.click(page.locator('.asset-card').filter({hasText:name}),'작업물 카드');await seen();report(info,'작업물','menu',m);
  await home(page);m=meter(page);await pick(m,await search(page,m,name),new RegExp(`^${name}`),'작업물 결과');await seen();report(info,'작업물','search',m);
 }finally{await context.close()}
});

test('사이드바: 1280×800 바닥 묶음이 화면 안, 모바일 시트 바닥 묶음',async({browser},info)=>{
 const {context,page}=await setup(browser,info,9);
 try{
  await home(page);const vh=page.viewportSize()!.height;
  if(isMobile(page)){await page.locator('.topbar').getByRole('button',{name:'검색',exact:true}).waitFor();await page.locator('[data-sidebar="trigger"]').first().click();}
  const bar=page.locator('[data-sidebar="sidebar"]'),settings=bar.getByRole('button',{name:'연결 및 설정',exact:true}),account=bar.getByRole('group',{name:'로그인 계정'});
  for(const l of [settings,account]){await expect(l).toBeInViewport({ratio:1});const box=await l.boundingBox();expect(box!.y+box!.height,'바닥 묶음이 화면 아래로 넘침').toBeLessThanOrEqual(vh)}
  if(!isMobile(page)){
   // 사이드바 전체는 스크롤되지 않고(바닥 묶음 고정), 주 메뉴 항목은 가운데 영역에 잘리지 않고 다 보인다. 브랜드 목록은 따로 스크롤해 마지막 브랜드까지 닿는다.
   for(const slot of ['sidebar-inner','sidebar-content'])expect(await page.locator(`[data-slot=${slot}]`).evaluate(e=>e.scrollHeight-e.clientHeight),`${slot} 스크롤`).toBeLessThanOrEqual(1);
   const content=await page.locator('[data-slot=sidebar-content]').boundingBox();
   for(const item of await page.getByRole('navigation',{name:'주 메뉴'}).locator('.sidebar-main [data-slot=sidebar-menu-button]').all()){const b=await item.boundingBox();expect(b!.y).toBeGreaterThanOrEqual(content!.y-1);expect(b!.y+b!.height).toBeLessThanOrEqual(content!.y+content!.height+1)}
   const last=page.locator('.sidebar-brands [data-slot=sidebar-menu-button]').last();await last.scrollIntoViewIfNeeded();await expect(last).toBeInViewport({ratio:1});await expect(settings).toBeInViewport({ratio:1});
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 }finally{await context.close()}
});
