// A8-3 고객 보고서 화면 여정(docs/CUSTOMER-REPORT.ko.md 11절): 점포 마케팅 지점 탭 '고객 보고서' → 끝난 주 선택 → 미리보기 → 동결 대화상자(보낼 확인 값) → 동결본·stale 표시 → 대표 '검토 완료' → MD 받기,
// 스위치 꺼짐의 동결본 목록 전용 화면, 관리자에게 '검토 완료' 없음, 직원에게 탭 없음, 브랜드 사실 탭의 '사실 팩 받기'.
// 로컬 빌드(wrangler --local, 실제 D1 시뮬레이터)와 실제 Chromium, 로그인 헤더(mocked auth). 지점은 실제 API로 만든다.
// /api/customer-reports는 page.route의 route.fulfill로 모의한다(mocked): 서버 계산·권한은 tests/customer-report-server.test.mjs가 실제 SQLite로 본다. 여기서는 화면이 받은 값을 그대로 보이고 보내는지 본다.
// 역할(관리자·직원)은 /api/auth 응답만 모의한다(화면 판정). 서버는 legacy 소유자라 지점 조회 등 실제 요청은 그대로 통과한다. route.fetch는 쓰지 않는다(docs/E2E.ko.md).
import {test,expect,type Browser,type Page,type TestInfo} from '@playwright/test';

const DAY=86400000;
const koreaToday=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
const addDays=(date:string,days:number)=>new Date(Date.parse(date+'T00:00:00Z')+days*DAY).toISOString().slice(0,10);
const mondayIndex=(t:number)=>(new Date(t).getUTCDay()+6)%7;
function isoWeek(date:string){
 const t=Date.parse(date+'T00:00:00Z'),thursday=t+(3-mondayIndex(t))*DAY,year=new Date(thursday).getUTCFullYear(),jan4=Date.UTC(year,0,4),week1=jan4-mondayIndex(jan4)*DAY;
 return `${year}-W${String(Math.floor((thursday-week1)/(7*DAY))+1).padStart(2,'0')}`;
}
// 끝난 KST ISO 주(월~일): 지난 일요일이 든 주와 그 앞 주.
const lastSunday=addDays(koreaToday(),-(mondayIndex(Date.parse(koreaToday()+'T00:00:00Z'))+1));
const WEEK=isoWeek(lastSunday),PREVIOUS=isoWeek(addDays(lastSunday,-7)),FROM=addDays(lastSunday,-6);

type Role='owner'|'admin'|'member';
async function open(browser:Browser,testInfo:TestInfo,role:Role){
 const {baseURL,viewport}=testInfo.project.use;
 const context=await browser.newContext({baseURL,viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`e2e-a83-${role}-${testInfo.project.name}-${Date.now()}`}});
 const page=await context.newPage();
 if(role!=='owner')await page.route(url=>url.pathname==='/api/auth',route=>route.fulfill({json:{mode:'email',user:{id:'u-'+role,email:role+'@example.test',role}}}));
 await page.request.get('/api/workspace');
 const saved=await page.request.post('/api/stores',{data:{action:'save_store',brandId:'oda',data:{name:'A8 보고서 지점',address:'서울 성수동 테스트 주소',tradeArea:'residential',goal:'주간 결산 확인'}}});
 expect(saved.status()).toBe(200);
 const {id:storeId}=await saved.json() as {id:string};
 return {context,page,storeId};
}

const ledger=(orders:number,netRevenue:number)=>({records:orders,orders,cancelled:0,refunded:0,netRevenue,contribution:null,unknownCostOrders:1,newCustomers:null,attributedOrders:2,adSpend:50000,productionCost:0,spendTotal:50000});
function previewOf(storeId:string,week:string,frozen:unknown[]){
 const orders=week===WEEK?12:7,netRevenue=week===WEEK?345000:180000;
 return {enabled:true,id:`store:${storeId}:${week}`,closed:true,bytes:4000,maxBytes:200000,tooLarge:false,confirm:{orders,netRevenue,posStatus:'pass'},frozen,
  preview:{schema:'collective.customer-report.v1',scope:{type:'store',id:storeId,brandId:'oda',name:'A8 보고서 지점',address:null,businessPhone:null},period:{week,from:FROM,to:lastSunday,timeZone:'Asia/Seoul',previousWeek:PREVIOUS},
   ledger:{current:ledger(orders,netRevenue),previous:ledger(9,280000)},completeness:[{week,weekStart:FROM,weekEnd:lastSunday,status:'pass',reason:'',ledgerNet:netRevenue,ledgerOrders:orders,posNet:netRevenue,posOrders:orders,diffRate:0,attributedOrders:2,attributedContribution:null}],
   northStar:{measured:true,weeks:[week],passedWeeks:1,excludedWeeks:0,northStarOrders:2,northStarContribution:null},channels:[],spendWarnings:[],connectors:[],publications:{total:0,byStatus:[]},todos:{dataRequests:[],placeMismatches:[]},facts:null,
   notices:['귀속은 증분이 아닙니다(합성).','자동 판정 아님(합성).'],masking:[]}};
}
const entryOf=(storeId:string,over:Record<string,unknown>={})=>({id:`store:${storeId}:${WEEK}`,scope:{type:'store',id:storeId,brandId:'oda'},week:WEEK,version:1,frozenAt:new Date().toISOString(),frozenBy:{id:'legacy',role:'owner'},review:null,stale:false,
 versions:[{version:1,frozenAt:new Date().toISOString(),review:null}],...over});

// /api/customer-reports 모의: 목록(from·to)·미리보기(week)·첨부(id)·쓰기(POST). 쓰기 요청 본문과 조회를 기록한다.
async function mockReports(page:Page,storeId:string,state:{enabled:boolean;frozen:Record<string,unknown>[]}){
 const posted:Record<string,unknown>[]=[],lists:URLSearchParams[]=[],previews:string[]=[];
 await page.route(url=>url.pathname==='/api/customer-reports',async route=>{
  const request=route.request(),params=new URL(request.url()).searchParams;
  if(request.method()==='POST'){
   const body=request.postDataJSON() as Record<string,unknown>;posted.push(body);
   if(body.action==='freeze'){state.frozen=[entryOf(storeId,{stale:true})];return route.fulfill({json:{id:`store:${storeId}:${WEEK}`,version:1,stale:false}})}
   const review={status:'reviewed',reportVersion:1,by:{id:'legacy',role:'owner'},at:new Date().toISOString()};
   state.frozen=state.frozen.map(e=>({...e,review}));return route.fulfill({json:{id:body.id,version:1,review}});
  }
  if(params.has('id'))return route.fulfill({status:200,headers:{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="customer-report-store-${storeId}-${WEEK}.md"`,'Cache-Control':'no-store'},body:'# 합성 고객 보고서\n'});
  if(params.has('from')){lists.push(params);return route.fulfill({json:{enabled:state.enabled,preview:null,frozen:state.frozen}})}
  const week=params.get('week')||'';previews.push(week);
  return route.fulfill({json:previewOf(storeId,week,state.frozen.filter(e=>e.week===week))});
 });
 return {posted,lists,previews};
}
const reportTab=(page:Page)=>page.getByRole('tab',{name:'고객 보고서',exact:true});

test('대표는 끝난 주를 미리 보고 확인 값 그대로 동결한 뒤 검토하고 MD를 받는다',async({browser},testInfo)=>{
 const {context,page,storeId}=await open(browser,testInfo,'owner');
 const state={enabled:true,frozen:[] as Record<string,unknown>[]},calls=await mockReports(page,storeId,state);
 await page.goto(`/?view=stores&brand=oda&store=${encodeURIComponent(storeId)}`);
 await reportTab(page).click();
 const week=page.getByRole('combobox',{name:'보고 주',exact:true});
 await expect(week).toHaveValue(WEEK);
 const preview=page.getByRole('article',{name:'보고서 미리보기'});
 await expect(preview.getByRole('listitem').filter({hasText:/^주문 수/})).toHaveText('주문 수 12건 (전주 9건)');
 await expect(preview.getByRole('listitem').filter({hasText:/^순매출/})).toHaveText('순매출 345,000원 (전주 280,000원)');
 await expect(preview).toContainText('POS 대조 통과');
 expect(calls.lists[0].get('to')).toBe(WEEK);expect(calls.lists[0].get('storeId')).toBe(storeId);
 await expect(page.getByText(`최근 26주 동결본이 없습니다.`,{exact:true})).toBeVisible();

 await preview.getByRole('button',{name:'동결하기',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:`${WEEK} 보고서 동결`});
 const values=dialog.getByRole('list',{name:'보낼 확인 값'});
 await expect(values.getByRole('listitem')).toHaveText(['주문 수 12건','순매출 345,000원','POS 대조 통과 (pass)']);
 await dialog.getByRole('button',{name:'이 값으로 동결',exact:true}).click();
 await expect(dialog).toBeHidden();
 expect(calls.posted).toEqual([{action:'freeze',storeId,week:WEEK,confirmed:true,expected:{orders:12,netRevenue:345000,posStatus:'pass'}}]);

 const frozen=page.getByRole('article',{name:`동결본 ${WEEK} v1`});
 await expect(frozen.getByText('장부 변경됨(stale)',{exact:false})).toBeVisible();
 await expect(preview).toContainText(`이 주 동결본 v1이 있습니다.`);
 await frozen.getByRole('button',{name:'검토 완료',exact:true}).click();
 await expect(frozen.getByRole('button',{name:'검토 완료',exact:true})).toHaveCount(0);
 await expect(frozen).toContainText('대표 검토');
 expect(calls.posted[1]).toEqual({action:'review',id:`store:${storeId}:${WEEK}`,version:1});

 const download=page.waitForEvent('download');
 await frozen.getByRole('button',{name:'MD 받기',exact:true}).click();
 expect((await download).suggestedFilename()).toBe(`customer-report-store-${storeId}-${WEEK}.md`);

 await week.selectOption(PREVIOUS);
 await expect(preview).toContainText('주문 수 7건');
 expect(calls.previews).toContain(PREVIOUS);
 await page.screenshot({path:`e2e/artifacts/${testInfo.project.name}-customer-report.png`,fullPage:true});
 await page.unrouteAll({behavior:'wait'});
 await context.close();
});

test('스위치가 꺼져 있으면 동결본 목록과 다운로드만 보인다',async({browser},testInfo)=>{
 const {context,page,storeId}=await open(browser,testInfo,'owner');
 const calls=await mockReports(page,storeId,{enabled:false,frozen:[entryOf(storeId)]});
 await page.goto(`/?view=stores&brand=oda&store=${encodeURIComponent(storeId)}&tab=report`);
 await expect(page.getByText('기능 스위치 a8_customer_report가 꺼져 있어',{exact:false})).toBeVisible();
 const frozen=page.getByRole('article',{name:`동결본 ${WEEK} v1`});
 await expect(frozen.getByRole('button',{name:'MD 받기',exact:true})).toBeVisible();
 await expect(frozen.getByRole('button',{name:'검토 완료',exact:true})).toHaveCount(0);
 await expect(page.getByRole('combobox',{name:'보고 주',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'동결하기',exact:true})).toHaveCount(0);
 expect(calls.previews).toEqual([]);
 await page.unrouteAll({behavior:'wait'});
 await context.close();
});

test('관리자는 동결할 수 있지만 검토 완료는 보이지 않는다',async({browser},testInfo)=>{
 const {context,page,storeId}=await open(browser,testInfo,'admin');
 await mockReports(page,storeId,{enabled:true,frozen:[entryOf(storeId)]});
 await page.goto(`/?view=stores&brand=oda&store=${encodeURIComponent(storeId)}`);
 await reportTab(page).click();
 await expect(page.getByRole('button',{name:'동결하기',exact:true})).toBeVisible();
 const frozen=page.getByRole('article',{name:`동결본 ${WEEK} v1`});
 await expect(frozen.getByRole('button',{name:'MD 받기',exact:true})).toBeVisible();
 await expect(frozen.getByRole('button',{name:'검토 완료',exact:true})).toHaveCount(0);
 await page.unrouteAll({behavior:'wait'});
 await context.close();
});

test('직원에게는 고객 보고서 탭과 사실 팩 받기가 없다',async({browser},testInfo)=>{
 const {context,page,storeId}=await open(browser,testInfo,'member');
 const calls=await mockReports(page,storeId,{enabled:true,frozen:[]});
 await page.goto(`/?view=stores&brand=oda&store=${encodeURIComponent(storeId)}`);
 await expect(page.getByRole('tab',{name:'조사 기록',exact:true})).toBeVisible();
 await expect(reportTab(page)).toHaveCount(0);
 await page.goto('/?view=brands&brand=oda&tab=facts');
 await expect(page.getByRole('heading',{name:'브랜드 확인 사실',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'사실 팩 받기',exact:true})).toHaveCount(0);
 expect(calls.lists.length+calls.previews.length).toBe(0);
 await page.unrouteAll({behavior:'wait'});
 await context.close();
});

test('대표는 브랜드 사실 탭에서 사실 팩을 받고, 꺼져 있으면 서버 문구를 본다',async({browser},testInfo)=>{
 const {context,page}=await open(browser,testInfo,'owner');
 const asked:URLSearchParams[]=[];
 await page.route(url=>url.pathname==='/api/customer-reports',route=>{
  const params=new URL(route.request().url()).searchParams;asked.push(params);
  if(asked.length===1)return route.fulfill({status:409,json:{error:'고객 보고서 기능이 꺼져 있습니다. 소유자가 기능 스위치 a8_customer_report를 켜야 합니다.'}});
  return route.fulfill({status:200,headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="fact-pack-oda-2026-09-27.csv"'},body:'﻿section,key\r\n'});
 });
 await page.goto('/?view=brands&brand=oda&tab=facts');
 const button=page.getByRole('button',{name:'사실 팩 받기',exact:true});
 await button.click();
 await expect(page.getByRole('alert').filter({hasText:'기능 스위치 a8_customer_report를 켜야 합니다'})).toBeVisible();
 await page.getByRole('combobox',{name:'사실 팩 형식',exact:true}).selectOption('csv');
 const download=page.waitForEvent('download');
 await button.click();
 expect((await download).suggestedFilename()).toBe('fact-pack-oda-2026-09-27.csv');
 expect(asked.map(p=>[p.get('type'),p.get('brandId'),p.get('format')])).toEqual([['fact_pack','oda','md'],['fact_pack','oda','csv']]);
 await page.unrouteAll({behavior:'wait'});
 await context.close();
});
